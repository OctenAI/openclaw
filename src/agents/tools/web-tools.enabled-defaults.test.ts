import { EnvHttpProxyAgent } from "undici";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withFetchPreconnect } from "../../test-utils/fetch-mock.js";
import { __testing as webSearchTesting } from "./web-search.js";
import { createWebFetchTool, createWebSearchTool } from "./web-tools.js";

function createOctenSuccessPayload(results?: Array<Record<string, unknown>>) {
  return {
    code: 0,
    msg: "success",
    data: {
      query: "test",
      results: results ?? [
        {
          title: "Test Result",
          url: "https://example.com",
          highlight: "Test highlight snippet",
          time_published: "2024-01-01",
        },
      ],
    },
    meta: {
      usage: { num_search_queries: 1 },
      latency: 100,
    },
  };
}

function installMockFetch(payload: unknown) {
  const mockFetch = vi.fn((_input?: unknown, _init?: unknown) =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve(payload),
    } as Response),
  );
  global.fetch = withFetchPreconnect(mockFetch);
  return mockFetch;
}

function createOctenSearchTool(octenConfig?: { apiKey?: string; baseUrl?: string }) {
  return createWebSearchTool({
    config: {
      tools: {
        web: {
          search: {
            provider: "octen",
            ...(octenConfig ? { octen: octenConfig } : {}),
          },
        },
      },
    },
    sandboxed: true,
  });
}

function parseFirstRequestBody(mockFetch: ReturnType<typeof installMockFetch>) {
  const request = mockFetch.mock.calls[0]?.[1] as RequestInit | undefined;
  const requestBody = request?.body;
  return JSON.parse(typeof requestBody === "string" ? requestBody : "{}") as Record<
    string,
    unknown
  >;
}

describe("web tools defaults", () => {
  it("enables web_fetch by default (non-sandbox)", () => {
    const tool = createWebFetchTool({ config: {}, sandboxed: false });
    expect(tool?.name).toBe("web_fetch");
  });

  it("disables web_fetch when explicitly disabled", () => {
    const tool = createWebFetchTool({
      config: { tools: { web: { fetch: { enabled: false } } } },
      sandboxed: false,
    });
    expect(tool).toBeNull();
  });

  it("enables web_search by default", () => {
    const tool = createWebSearchTool({ config: {}, sandboxed: false });
    expect(tool?.name).toBe("web_search");
  });

  it("disables web_search when explicitly disabled", () => {
    const tool = createWebSearchTool({
      config: { tools: { web: { search: { enabled: false } } } },
      sandboxed: false,
    });
    expect(tool).toBeNull();
  });
});

describe("web_search octen provider", () => {
  const priorFetch = global.fetch;

  afterEach(() => {
    vi.unstubAllEnvs();
    global.fetch = priorFetch;
    webSearchTesting.SEARCH_CACHE.clear();
  });

  it("returns missing_octen_api_key when no API key is available", async () => {
    vi.stubEnv("OCTEN_API_KEY", "");
    const tool = createOctenSearchTool();
    const result = await tool?.execute?.("call-1", { query: "test" });
    expect(result?.details).toMatchObject({ error: "missing_octen_api_key" });
  });

  it("uses OCTEN_API_KEY from environment", async () => {
    vi.stubEnv("OCTEN_API_KEY", "octen-env-key"); // pragma: allowlist secret
    const mockFetch = installMockFetch(createOctenSuccessPayload());
    const tool = createOctenSearchTool();
    await tool?.execute?.("call-1", { query: "test" });

    expect(mockFetch).toHaveBeenCalled();
    const headers = (mockFetch.mock.calls[0]?.[1] as RequestInit | undefined)?.headers as
      | Record<string, string>
      | undefined;
    expect(headers?.["x-api-key"]).toBe("octen-env-key");
  });

  it("uses config API key over environment variable", async () => {
    vi.stubEnv("OCTEN_API_KEY", "octen-env-key"); // pragma: allowlist secret
    const mockFetch = installMockFetch(createOctenSuccessPayload());
    const tool = createOctenSearchTool({ apiKey: "octen-config-key" }); // pragma: allowlist secret
    await tool?.execute?.("call-1", { query: "test" });

    expect(mockFetch).toHaveBeenCalled();
    const headers = (mockFetch.mock.calls[0]?.[1] as RequestInit | undefined)?.headers as
      | Record<string, string>
      | undefined;
    expect(headers?.["x-api-key"]).toBe("octen-config-key");
  });

  it("sends POST request to Octen search endpoint", async () => {
    vi.stubEnv("OCTEN_API_KEY", "octen-test-key"); // pragma: allowlist secret
    const mockFetch = installMockFetch(createOctenSuccessPayload());
    const tool = createOctenSearchTool();
    await tool?.execute?.("call-1", { query: "AI news" });

    expect(mockFetch).toHaveBeenCalled();
    const url = mockFetch.mock.calls[0]?.[0] as string;
    expect(url).toBe("https://api.octen.ai/v1/search");
    expect((mockFetch.mock.calls[0]?.[1] as RequestInit | undefined)?.method).toBe("POST");
  });

  it("passes query and count in request body", async () => {
    vi.stubEnv("OCTEN_API_KEY", "octen-test-key"); // pragma: allowlist secret
    const mockFetch = installMockFetch(createOctenSuccessPayload());
    const tool = createOctenSearchTool();
    await tool?.execute?.("call-1", { query: "test query", count: 3 });

    const body = parseFirstRequestBody(mockFetch);
    expect(body.query).toBe("test query");
    expect(body.count).toBe(3);
  });

  it("returns parsed results from Octen API response", async () => {
    vi.stubEnv("OCTEN_API_KEY", "octen-test-key"); // pragma: allowlist secret
    installMockFetch(
      createOctenSuccessPayload([
        {
          title: "Example Page",
          url: "https://example.com/page",
          highlight: "This is a highlight snippet",
          time_published: "2024-06-15",
        },
      ]),
    );
    const tool = createOctenSearchTool();
    const result = await tool?.execute?.("call-1", { query: "test" });

    expect(result?.details).toMatchObject({
      provider: "octen",
      externalContent: { untrusted: true, source: "web_search", wrapped: true },
      results: expect.arrayContaining([
        expect.objectContaining({
          url: "https://example.com/page",
          title: "Example Page",
          highlight: "This is a highlight snippet",
        }),
      ]),
    });
  });

  it("caches results for identical queries", async () => {
    vi.stubEnv("OCTEN_API_KEY", "octen-test-key"); // pragma: allowlist secret
    const mockFetch = installMockFetch(createOctenSuccessPayload());
    const tool = createOctenSearchTool();

    await tool?.execute?.("call-1", { query: "cached-query" });
    await tool?.execute?.("call-2", { query: "cached-query" });

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("uses proxy-aware dispatcher when HTTP_PROXY is configured", async () => {
    vi.stubEnv("HTTP_PROXY", "http://127.0.0.1:7890");
    vi.stubEnv("OCTEN_API_KEY", "octen-test-key"); // pragma: allowlist secret
    const mockFetch = installMockFetch(createOctenSuccessPayload());
    const tool = createOctenSearchTool();

    await tool?.execute?.("call-1", { query: "proxy-test" });

    const requestInit = mockFetch.mock.calls[0]?.[1] as
      | (RequestInit & { dispatcher?: unknown })
      | undefined;
    expect(requestInit?.dispatcher).toBeInstanceOf(EnvHttpProxyAgent);
  });

  it("sets Content-Type header to application/json", async () => {
    vi.stubEnv("OCTEN_API_KEY", "octen-test-key"); // pragma: allowlist secret
    const mockFetch = installMockFetch(createOctenSuccessPayload());
    const tool = createOctenSearchTool();
    await tool?.execute?.("call-1", { query: "test" });

    const headers = (mockFetch.mock.calls[0]?.[1] as RequestInit | undefined)?.headers as
      | Record<string, string>
      | undefined;
    expect(headers?.["Content-Type"]).toBe("application/json");
  });

  it("uses default count when count is not specified", async () => {
    vi.stubEnv("OCTEN_API_KEY", "octen-test-key"); // pragma: allowlist secret
    const mockFetch = installMockFetch(createOctenSuccessPayload());
    const tool = createOctenSearchTool();
    await tool?.execute?.("call-1", { query: "test" });

    const body = parseFirstRequestBody(mockFetch);
    expect(body.count).toBe(5);
  });

  it("schema exposes only query and count parameters", () => {
    vi.stubEnv("OCTEN_API_KEY", "octen-test-key"); // pragma: allowlist secret
    const tool = createOctenSearchTool();
    const properties = (tool?.parameters as { properties?: Record<string, unknown> } | undefined)
      ?.properties;

    expect(properties?.query).toBeDefined();
    expect(properties?.count).toBeDefined();
    expect(Object.keys(properties ?? {})).toHaveLength(2);
  });
});
