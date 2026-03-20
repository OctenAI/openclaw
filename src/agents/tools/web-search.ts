import { Type } from "@sinclair/typebox";
import { formatCliCommand } from "../../cli/command-format.js";
import type { OpenClawConfig } from "../../config/config.js";
import { normalizeResolvedSecretInputString } from "../../config/types.secrets.js";
import { logVerbose } from "../../globals.js";
import type { RuntimeWebSearchMetadata } from "../../secrets/runtime-web-tools.js";
import { wrapWebContent } from "../../security/external-content.js";
import { normalizeSecretInput } from "../../utils/normalize-secret-input.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readNumberParam, readStringArrayParam, readStringParam } from "./common.js";
import { withTrustedWebToolsEndpoint } from "./web-guarded-fetch.js";
import { resolveCitationRedirectUrl } from "./web-search-citation-redirect.js";
import {
  CacheEntry,
  DEFAULT_CACHE_TTL_MINUTES,
  DEFAULT_TIMEOUT_SECONDS,
  normalizeCacheKey,
  readCache,
  readResponseText,
  resolveCacheTtlMs,
  resolveTimeoutSeconds,
  writeCache,
} from "./web-shared.js";

const SEARCH_PROVIDERS = ["octen"] as const;
const DEFAULT_SEARCH_COUNT = 5;
const MAX_SEARCH_COUNT = 10;

const DEFAULT_OCTEN_BASE_URL = "https://api.octen.ai";
const OCTEN_SEARCH_ENDPOINT = "/search";

const SEARCH_CACHE = new Map<string, CacheEntry<Record<string, unknown>>>();

// Removed old date conversion functions - not needed for Octen

function createWebSearchSchema() {
  return Type.Object({
    query: Type.String({ description: "Search query string." }),
    count: Type.Optional(
      Type.Number({
        description: "Number of results to return (1-10).",
        minimum: 1,
        maximum: MAX_SEARCH_COUNT,
      }),
    ),
  });
}

type WebSearchConfig = NonNullable<OpenClawConfig["tools"]>["web"] extends infer Web
  ? Web extends { search?: infer Search }
    ? Search
    : undefined
  : undefined;

type OctenConfig = {
  apiKey?: string;
  baseUrl?: string;
};

// Removed old provider type definitions - only Octen is supported

// Removed old provider extraction functions and types - only Octen is supported

function resolveSearchConfig(cfg?: OpenClawConfig): WebSearchConfig {
  const search = cfg?.tools?.web?.search;
  if (!search || typeof search !== "object") {
    return undefined;
  }
  return search as WebSearchConfig;
}

function resolveSearchEnabled(params: { search?: WebSearchConfig; sandboxed?: boolean }): boolean {
  if (typeof params.search?.enabled === "boolean") {
    return params.search.enabled;
  }
  if (params.sandboxed) {
    return true;
  }
  return true;
}

function missingSearchKeyPayload() {
  return {
    error: "missing_octen_api_key",
    message:
      "web_search (octen) needs an Octen API key. Set OCTEN_API_KEY in the Gateway environment, or configure tools.web.search.octen.apiKey.",
    docs: "https://docs.openclaw.ai/tools/web",
  };
}

function resolveSearchProvider(search?: WebSearchConfig): (typeof SEARCH_PROVIDERS)[number] {
  const raw =
    search && "provider" in search && typeof search.provider === "string"
      ? search.provider.trim().toLowerCase()
      : "";

  if (raw === "octen") {
    return "octen";
  }

  // Auto-detect Octen from available API keys
  if (raw === "") {
    const octenConfig = resolveOctenConfig(search);
    if (resolveOctenApiKey(octenConfig)) {
      logVerbose(
        'web_search: no provider configured, auto-detected "octen" from available API keys',
      );
      return "octen";
    }
  }

  return "octen";
}

function normalizeApiKey(key: unknown): string {
  return normalizeSecretInput(key);
}

function resolveOctenConfig(search?: WebSearchConfig): OctenConfig {
  if (!search || typeof search !== "object") {
    return {};
  }
  const octen = "octen" in search ? search.octen : undefined;
  if (!octen || typeof octen !== "object") {
    return {};
  }
  return octen as OctenConfig;
}

function resolveOctenApiKey(octen?: OctenConfig): string | undefined {
  const fromConfig = normalizeApiKey(octen?.apiKey);
  if (fromConfig) {
    return fromConfig;
  }
  const fromEnv = normalizeApiKey(process.env.OCTEN_API_KEY);
  return fromEnv || undefined;
}

function resolveOctenBaseUrl(octen?: OctenConfig): string {
  const fromConfig =
    octen && "baseUrl" in octen && typeof octen.baseUrl === "string" ? octen.baseUrl.trim() : "";
  return fromConfig || DEFAULT_OCTEN_BASE_URL;
}

async function withTrustedWebSearchEndpoint<T>(
  params: {
    url: string;
    timeoutSeconds: number;
    init: RequestInit;
  },
  run: (response: Response) => Promise<T>,
): Promise<T> {
  return withTrustedWebToolsEndpoint(
    {
      url: params.url,
      init: params.init,
      timeoutSeconds: params.timeoutSeconds,
    },
    async ({ response }) => run(response),
  );
}

// Removed old provider search functions - only Octen is supported

function resolveSearchCount(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  const clamped = Math.max(1, Math.min(MAX_SEARCH_COUNT, Math.floor(parsed)));
  return clamped;
}

async function runOctenSearch(params: {
  query: string;
  count: number;
  apiKey: string;
  baseUrl: string;
  timeoutSeconds: number;
  includeDomains?: string[];
  excludeDomains?: string[];
  includeText?: string[];
  excludeText?: string[];
  timeBasis?: string;
  startTime?: string;
  endTime?: string;
  highlightEnable?: boolean;
  highlightMaxTokens?: number;
  format?: string;
  safesearch?: string;
  fullContentEnable?: boolean;
  fullContentMaxTokens?: number;
}): Promise<{
  results: Array<{
    url: string;
    title: string;
    snippet?: string;
    highlight?: string;
    fullContent?: string;
    authors?: string;
    timePublished?: string;
    timeCrawled?: string;
  }>;
}> {
  const requestBody: Record<string, unknown> = {
    query: params.query,
    count: params.count,
  };

  if (params.includeDomains && params.includeDomains.length > 0) {
    requestBody.include_domains = params.includeDomains;
  }
  if (params.excludeDomains && params.excludeDomains.length > 0) {
    requestBody.exclude_domains = params.excludeDomains;
  }
  if (params.includeText && params.includeText.length > 0) {
    requestBody.include_text = params.includeText;
  }
  if (params.excludeText && params.excludeText.length > 0) {
    requestBody.exclude_text = params.excludeText;
  }
  if (params.timeBasis) {
    requestBody.time_basis = params.timeBasis;
  }
  if (params.startTime) {
    requestBody.start_time = params.startTime;
  }
  if (params.endTime) {
    requestBody.end_time = params.endTime;
  }
  if (params.highlightEnable !== undefined || params.highlightMaxTokens !== undefined) {
    requestBody.highlight = {
      enable: params.highlightEnable ?? true,
      ...(params.highlightMaxTokens !== undefined && { max_tokens: params.highlightMaxTokens }),
    };
  }
  if (params.format) {
    requestBody.format = params.format;
  }
  if (params.safesearch) {
    requestBody.safesearch = params.safesearch;
  }
  if (params.fullContentEnable !== undefined || params.fullContentMaxTokens !== undefined) {
    requestBody.full_content = {
      enable: params.fullContentEnable ?? false,
      ...(params.fullContentMaxTokens !== undefined && { max_tokens: params.fullContentMaxTokens }),
    };
  }

  const url = `${params.baseUrl}${OCTEN_SEARCH_ENDPOINT}`;

  return withTrustedWebSearchEndpoint(
    {
      url,
      timeoutSeconds: params.timeoutSeconds,
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": params.apiKey,
        },
        body: JSON.stringify(requestBody),
      },
    },
    async (res) => {
      if (!res.ok) {
        const detailResult = await readResponseText(res, { maxBytes: 64_000 });
        const detail = detailResult.text;
        throw new Error(`Octen API error (${res.status}): ${detail || res.statusText}`);
      }

      const data = (await res.json()) as {
        code: number;
        msg: string;
        data?: {
          query?: string;
          results?: Array<{
            title?: string;
            url?: string;
            highlight?: string;
            full_content?: string;
            authors?: string;
            time_published?: string;
            time_last_crawled?: string;
          }>;
        };
        meta?: {
          usage?: {
            num_search_queries?: number;
            full_content_tokens?: number;
          };
          latency?: number;
          warning?: string | null;
        };
      };

      if (data.code !== 0) {
        throw new Error(`Octen API error: ${data.msg}`);
      }

      const results = (data.data?.results ?? []).map((result) => ({
        url: result.url ?? "",
        title: result.title ?? "",
        snippet: result.highlight,
        highlight: result.highlight,
        fullContent: result.full_content,
        authors: result.authors,
        timePublished: result.time_published,
        timeCrawled: result.time_last_crawled,
      }));

      return { results };
    },
  );
}

// Removed old Brave search function - only Octen is supported

async function runWebSearch(params: {
  query: string;
  count: number;
  apiKey: string;
  timeoutSeconds: number;
  cacheTtlMs: number;
  provider: (typeof SEARCH_PROVIDERS)[number];
  octenBaseUrl?: string;
}): Promise<Record<string, unknown>> {
  const cacheKey = normalizeCacheKey(
    `octen:${params.query}:${params.count}:${params.octenBaseUrl || DEFAULT_OCTEN_BASE_URL}`,
  );
  const cached = readCache(SEARCH_CACHE, cacheKey);
  if (cached) {
    return { ...cached.value, cached: true };
  }

  const start = Date.now();

  // Only support Octen provider
  if (params.provider !== "octen") {
    throw new Error(`Unsupported search provider: ${params.provider}. Only "octen" is supported.`);
  }

  // Octen search implementation
  const results = await runOctenSearch({
    query: params.query,
    count: params.count,
    apiKey: params.apiKey,
    baseUrl: params.octenBaseUrl ?? DEFAULT_OCTEN_BASE_URL,
    timeoutSeconds: params.timeoutSeconds,
  });

  const payload = {
    query: params.query,
    provider: "octen",
    count: results.results.length,
    tookMs: Date.now() - start,
    externalContent: {
      untrusted: true,
      source: "web_search",
      provider: "octen",
      wrapped: true,
    },
    results: results.results,
  };
  writeCache(SEARCH_CACHE, cacheKey, payload, params.cacheTtlMs);
  return payload;
}


export function createWebSearchTool(options?: {
  config?: OpenClawConfig;
  sandboxed?: boolean;
  runtimeWebSearch?: RuntimeWebSearchMetadata;
}): AnyAgentTool | null {
  const search = resolveSearchConfig(options?.config);
  if (!resolveSearchEnabled({ search, sandboxed: options?.sandboxed })) {
    return null;
  }

  const provider =
    options?.runtimeWebSearch?.selectedProvider ??
    options?.runtimeWebSearch?.providerConfigured ??
    resolveSearchProvider(search);
  const octenConfig = resolveOctenConfig(search);

  const description =
    "Search the web using Octen Search API. Returns ranked web results with optional filters, highlights, and full content. Supports domain filtering, time range filtering, and content extraction.";

  return {
    label: "Web Search",
    name: "web_search",
    description,
    parameters: createWebSearchSchema(),
    execute: async (_toolCallId, args) => {
      const apiKey = resolveOctenApiKey(octenConfig);

      if (!apiKey) {
        return jsonResult(missingSearchKeyPayload());
      }

      const params = args as Record<string, unknown>;
      const query = readStringParam(params, "query", { required: true });
      const count =
        readNumberParam(params, "count", { integer: true }) ?? search?.maxResults ?? undefined;

      const result = await runWebSearch({
        query,
        count: resolveSearchCount(count, DEFAULT_SEARCH_COUNT),
        apiKey,
        timeoutSeconds: resolveTimeoutSeconds(search?.timeoutSeconds, DEFAULT_TIMEOUT_SECONDS),
        cacheTtlMs: resolveCacheTtlMs(search?.cacheTtlMinutes, DEFAULT_CACHE_TTL_MINUTES),
        provider: "octen",
        octenBaseUrl: resolveOctenBaseUrl(octenConfig),
      });
      return jsonResult(result);
    },
  };
}

export const __testing = {
  resolveSearchProvider,
  SEARCH_CACHE,
} as const;
