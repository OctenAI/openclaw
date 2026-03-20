import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validateConfigObject } from "./config.js";
import { buildWebSearchProviderConfig } from "./test-helpers.js";

vi.mock("../runtime.js", () => ({
  defaultRuntime: { log: vi.fn(), error: vi.fn() },
}));

const { __testing } = await import("../agents/tools/web-search.js");
const { resolveSearchProvider } = __testing;

describe("web search provider config", () => {
  it("accepts octen provider with apiKey and baseUrl config", () => {
    const res = validateConfigObject(
      buildWebSearchProviderConfig({
        enabled: true,
        provider: "octen",
        providerConfig: {
          apiKey: "test-key", // pragma: allowlist secret
          baseUrl: "https://api.octen.ai",
        },
      }),
    );

    expect(res.ok).toBe(true);
  });

  it("accepts octen provider with no extra config", () => {
    const res = validateConfigObject(
      buildWebSearchProviderConfig({
        provider: "octen",
      }),
    );

    expect(res.ok).toBe(true);
  });

  it("accepts octen provider with only apiKey", () => {
    const res = validateConfigObject(
      buildWebSearchProviderConfig({
        provider: "octen",
        providerConfig: {
          apiKey: "octen-test-key", // pragma: allowlist secret
        },
      }),
    );

    expect(res.ok).toBe(true);
  });

  it("rejects unknown provider config keys", () => {
    const res = validateConfigObject(
      buildWebSearchProviderConfig({
        provider: "octen",
        providerConfig: {
          apiKey: "test-key", // pragma: allowlist secret
          unknownField: "invalid",
        },
      }),
    );

    expect(res.ok).toBe(false);
  });
});

describe("web search provider resolution", () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.OCTEN_API_KEY;
  });

  afterEach(() => {
    process.env = { ...savedEnv };
    vi.restoreAllMocks();
  });

  it("defaults to octen when no config provided", () => {
    expect(resolveSearchProvider({})).toBe("octen");
  });

  it("returns octen when OCTEN_API_KEY is set", () => {
    process.env.OCTEN_API_KEY = "test-octen-key"; // pragma: allowlist secret
    expect(resolveSearchProvider({})).toBe("octen");
  });

  it("returns octen when no API keys are available", () => {
    expect(resolveSearchProvider(undefined)).toBe("octen");
  });

  it("returns octen when provider is explicitly set to octen", () => {
    expect(
      resolveSearchProvider({ provider: "octen" } as unknown as Parameters<
        typeof resolveSearchProvider
      >[0]),
    ).toBe("octen");
  });

  it("returns octen regardless of other provider env vars", () => {
    process.env.BRAVE_API_KEY = "test-brave-key"; // pragma: allowlist secret
    process.env.GEMINI_API_KEY = "test-gemini-key"; // pragma: allowlist secret
    expect(resolveSearchProvider({})).toBe("octen");
  });
});
