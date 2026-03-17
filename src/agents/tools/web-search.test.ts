import { describe, expect, it } from "vitest";
import { __testing } from "./web-search.js";

const { resolveSearchProvider, SEARCH_CACHE } = __testing;

describe("web_search octen provider", () => {
  it("resolves octen as the only provider", () => {
    expect(resolveSearchProvider(undefined)).toBe("octen");
    expect(resolveSearchProvider({ provider: "octen" })).toBe("octen");
  });

  it("defaults to octen for any provider string", () => {
    expect(resolveSearchProvider({ provider: "unknown" })).toBe("octen");
    expect(resolveSearchProvider({ provider: "" })).toBe("octen");
  });

  it("has a working search cache", () => {
    expect(SEARCH_CACHE).toBeDefined();
    expect(SEARCH_CACHE instanceof Map).toBe(true);
  });
});
