import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import * as secretResolve from "./resolve.js";
import { createResolverContext } from "./runtime-shared.js";
import { resolveRuntimeWebTools } from "./runtime-web-tools.js";

function asConfig(value: unknown): OpenClawConfig {
  return value as OpenClawConfig;
}

async function runRuntimeWebTools(params: { config: OpenClawConfig; env?: NodeJS.ProcessEnv }) {
  const sourceConfig = structuredClone(params.config);
  const resolvedConfig = structuredClone(params.config);
  const context = createResolverContext({
    sourceConfig,
    env: params.env ?? {},
  });
  const metadata = await resolveRuntimeWebTools({
    sourceConfig,
    resolvedConfig,
    context,
  });
  return { metadata, resolvedConfig, context };
}

function expectInactiveFirecrawlSecretRef(params: {
  resolveSpy: ReturnType<typeof vi.spyOn>;
  metadata: Awaited<ReturnType<typeof runRuntimeWebTools>>["metadata"];
  context: Awaited<ReturnType<typeof runRuntimeWebTools>>["context"];
}) {
  expect(params.resolveSpy).not.toHaveBeenCalled();
  expect(params.metadata.fetch.firecrawl.active).toBe(false);
  expect(params.metadata.fetch.firecrawl.apiKeySource).toBe("secretRef");
  expect(params.context.warnings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: "SECRETS_REF_IGNORED_INACTIVE_SURFACE",
        path: "tools.web.fetch.firecrawl.apiKey",
      }),
    ]),
  );
}

describe("runtime web tools resolution", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves configured octen provider SecretRef", async () => {
    const { metadata, resolvedConfig, context } = await runRuntimeWebTools({
      config: asConfig({
        tools: {
          web: {
            search: {
              enabled: true,
              provider: "octen",
              octen: {
                apiKey: { source: "env", provider: "default", id: "OCTEN_PROVIDER_REF" },
              },
            },
          },
        },
      }),
      env: {
        OCTEN_PROVIDER_REF: "octen-provider-key", // pragma: allowlist secret
      },
    });

    expect(metadata.search.providerConfigured).toBe("octen");
    expect(metadata.search.providerSource).toBe("configured");
    expect(metadata.search.selectedProvider).toBe("octen");
    expect(metadata.search.selectedProviderKeySource).toBe("secretRef");
    expect(resolvedConfig.tools?.web?.search?.octen?.apiKey).toBe("octen-provider-key");
    expect(context.warnings.map((warning) => warning.code)).not.toContain(
      "WEB_SEARCH_KEY_UNRESOLVED_NO_FALLBACK",
    );
  });

  it("auto-detects octen provider from configured SecretRef", async () => {
    const { metadata, resolvedConfig } = await runRuntimeWebTools({
      config: asConfig({
        tools: {
          web: {
            search: {
              octen: {
                apiKey: { source: "env", provider: "default", id: "OCTEN_API_KEY_REF" },
              },
            },
          },
        },
      }),
      env: {
        OCTEN_API_KEY_REF: "octen-runtime-key", // pragma: allowlist secret
      },
    });

    expect(metadata.search.providerSource).toBe("auto-detect");
    expect(metadata.search.selectedProvider).toBe("octen");
    expect(metadata.search.selectedProviderKeySource).toBe("secretRef");
    expect(resolvedConfig.tools?.web?.search?.octen?.apiKey).toBe("octen-runtime-key");
  });

  it("auto-detects octen from OCTEN_API_KEY env var", async () => {
    const { metadata } = await runRuntimeWebTools({
      config: asConfig({
        tools: {
          web: {
            search: {},
          },
        },
      }),
      env: {
        OCTEN_API_KEY: "octen-env-key", // pragma: allowlist secret
      },
    });

    expect(metadata.search.providerSource).toBe("auto-detect");
    expect(metadata.search.selectedProvider).toBe("octen");
    expect(metadata.search.selectedProviderKeySource).toBe("env");
  });

  it("warns when provider is invalid and falls back to auto-detect", async () => {
    const { metadata, context } = await runRuntimeWebTools({
      config: asConfig({
        tools: {
          web: {
            search: {
              provider: "invalid-provider",
              octen: {
                apiKey: { source: "env", provider: "default", id: "OCTEN_API_KEY_REF" },
              },
            },
          },
        },
      }),
      env: {
        OCTEN_API_KEY_REF: "octen-runtime-key", // pragma: allowlist secret
      },
    });

    expect(metadata.search.providerConfigured).toBeUndefined();
    expect(metadata.search.providerSource).toBe("auto-detect");
    expect(metadata.search.selectedProvider).toBe("octen");
    expect(metadata.search.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "WEB_SEARCH_PROVIDER_INVALID_AUTODETECT",
          path: "tools.web.search.provider",
        }),
      ]),
    );
    expect(context.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "WEB_SEARCH_PROVIDER_INVALID_AUTODETECT",
          path: "tools.web.search.provider",
        }),
      ]),
    );
  });

  it("fails fast when configured provider ref is unresolved with no fallback", async () => {
    const sourceConfig = asConfig({
      tools: {
        web: {
          search: {
            provider: "octen",
            octen: {
              apiKey: { source: "env", provider: "default", id: "MISSING_OCTEN_API_KEY_REF" },
            },
          },
        },
      },
    });
    const resolvedConfig = structuredClone(sourceConfig);
    const context = createResolverContext({
      sourceConfig,
      env: {},
    });

    await expect(
      resolveRuntimeWebTools({
        sourceConfig,
        resolvedConfig,
        context,
      }),
    ).rejects.toThrow("[WEB_SEARCH_KEY_UNRESOLVED_NO_FALLBACK]");
    expect(context.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "WEB_SEARCH_KEY_UNRESOLVED_NO_FALLBACK",
          path: "tools.web.search.octen.apiKey",
        }),
      ]),
    );
  });

  it("uses env fallback for unresolved octen SecretRef", async () => {
    const { metadata, resolvedConfig, context } = await runRuntimeWebTools({
      config: asConfig({
        tools: {
          web: {
            search: {
              provider: "octen",
              octen: {
                apiKey: { source: "env", provider: "default", id: "MISSING_OCTEN_REF" },
              },
            },
          },
        },
      }),
      env: {
        OCTEN_API_KEY: "octen-fallback-key", // pragma: allowlist secret
      },
    });

    expect(metadata.search.providerConfigured).toBe("octen");
    expect(metadata.search.selectedProvider).toBe("octen");
    expect(metadata.search.selectedProviderKeySource).toBe("env");
    expect(resolvedConfig.tools?.web?.search?.octen?.apiKey).toBe("octen-fallback-key");
    expect(context.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "WEB_SEARCH_KEY_UNRESOLVED_FALLBACK_USED",
          path: "tools.web.search.octen.apiKey",
        }),
      ]),
    );
  });

  it("does not resolve Firecrawl SecretRef when Firecrawl is inactive", async () => {
    const resolveSpy = vi.spyOn(secretResolve, "resolveSecretRefValues");
    const { metadata, context } = await runRuntimeWebTools({
      config: asConfig({
        tools: {
          web: {
            fetch: {
              enabled: false,
              firecrawl: {
                apiKey: { source: "env", provider: "default", id: "MISSING_FIRECRAWL_REF" },
              },
            },
          },
        },
      }),
    });

    expectInactiveFirecrawlSecretRef({ resolveSpy, metadata, context });
  });

  it("does not resolve Firecrawl SecretRef when Firecrawl is disabled", async () => {
    const resolveSpy = vi.spyOn(secretResolve, "resolveSecretRefValues");
    const { metadata, context } = await runRuntimeWebTools({
      config: asConfig({
        tools: {
          web: {
            fetch: {
              enabled: true,
              firecrawl: {
                enabled: false,
                apiKey: { source: "env", provider: "default", id: "MISSING_FIRECRAWL_REF" },
              },
            },
          },
        },
      }),
    });

    expectInactiveFirecrawlSecretRef({ resolveSpy, metadata, context });
  });

  it("uses env fallback for unresolved Firecrawl SecretRef when active", async () => {
    const { metadata, resolvedConfig, context } = await runRuntimeWebTools({
      config: asConfig({
        tools: {
          web: {
            fetch: {
              firecrawl: {
                apiKey: { source: "env", provider: "default", id: "MISSING_FIRECRAWL_REF" },
              },
            },
          },
        },
      }),
      env: {
        FIRECRAWL_API_KEY: "firecrawl-fallback-key", // pragma: allowlist secret
      },
    });

    expect(metadata.fetch.firecrawl.active).toBe(true);
    expect(metadata.fetch.firecrawl.apiKeySource).toBe("env");
    expect(resolvedConfig.tools?.web?.fetch?.firecrawl?.apiKey).toBe("firecrawl-fallback-key");
    expect(context.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "WEB_FETCH_FIRECRAWL_KEY_UNRESOLVED_FALLBACK_USED",
          path: "tools.web.fetch.firecrawl.apiKey",
        }),
      ]),
    );
  });

  it("fails fast when active Firecrawl SecretRef is unresolved with no fallback", async () => {
    const sourceConfig = asConfig({
      tools: {
        web: {
          fetch: {
            firecrawl: {
              apiKey: { source: "env", provider: "default", id: "MISSING_FIRECRAWL_REF" },
            },
          },
        },
      },
    });
    const resolvedConfig = structuredClone(sourceConfig);
    const context = createResolverContext({
      sourceConfig,
      env: {},
    });

    await expect(
      resolveRuntimeWebTools({
        sourceConfig,
        resolvedConfig,
        context,
      }),
    ).rejects.toThrow("[WEB_FETCH_FIRECRAWL_KEY_UNRESOLVED_NO_FALLBACK]");
    expect(context.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "WEB_FETCH_FIRECRAWL_KEY_UNRESOLVED_NO_FALLBACK",
          path: "tools.web.fetch.firecrawl.apiKey",
        }),
      ]),
    );
  });
});
