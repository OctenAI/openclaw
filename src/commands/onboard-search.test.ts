import { describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import type { RuntimeEnv } from "../runtime.js";
import type { WizardPrompter } from "../wizard/prompts.js";
import { SEARCH_PROVIDER_OPTIONS, setupSearch } from "./onboard-search.js";

const runtime: RuntimeEnv = {
  log: vi.fn(),
  error: vi.fn(),
  exit: ((code: number) => {
    throw new Error(`unexpected exit ${code}`);
  }) as RuntimeEnv["exit"],
};

function createPrompter(params: { selectValue?: string; textValue?: string }): {
  prompter: WizardPrompter;
  notes: Array<{ title?: string; message: string }>;
} {
  const notes: Array<{ title?: string; message: string }> = [];
  const prompter: WizardPrompter = {
    intro: vi.fn(async () => {}),
    outro: vi.fn(async () => {}),
    note: vi.fn(async (message: string, title?: string) => {
      notes.push({ title, message });
    }),
    select: vi.fn(
      async () => params.selectValue ?? "octen",
    ) as unknown as WizardPrompter["select"],
    multiselect: vi.fn(async () => []) as unknown as WizardPrompter["multiselect"],
    text: vi.fn(async () => params.textValue ?? ""),
    confirm: vi.fn(async () => true),
    progress: vi.fn(() => ({ update: vi.fn(), stop: vi.fn() })),
  };
  return { prompter, notes };
}

function createOctenConfig(apiKey: string, enabled?: boolean): OpenClawConfig {
  return {
    tools: {
      web: {
        search: {
          provider: "octen",
          ...(enabled === undefined ? {} : { enabled }),
          octen: { apiKey },
        },
      },
    },
  };
}

async function runBlankOctenKeyEntry(
  apiKey: string,
  enabled?: boolean,
): Promise<OpenClawConfig> {
  const cfg = createOctenConfig(apiKey, enabled);
  const { prompter } = createPrompter({
    selectValue: "octen",
    textValue: "",
  });
  return setupSearch(cfg, runtime, prompter);
}

async function runQuickstartOctenSetup(
  apiKey: string,
  enabled?: boolean,
): Promise<{ result: OpenClawConfig; prompter: WizardPrompter }> {
  const cfg = createOctenConfig(apiKey, enabled);
  const { prompter } = createPrompter({ selectValue: "octen" });
  const result = await setupSearch(cfg, runtime, prompter, {
    quickstartDefaults: true,
  });
  return { result, prompter };
}

describe("setupSearch", () => {
  it("returns config unchanged when user skips", async () => {
    const cfg: OpenClawConfig = {};
    const { prompter } = createPrompter({ selectValue: "__skip__" });
    const result = await setupSearch(cfg, runtime, prompter);
    expect(result).toBe(cfg);
  });

  it("sets provider and key for octen", async () => {
    const cfg: OpenClawConfig = {};
    const { prompter } = createPrompter({
      selectValue: "octen",
      textValue: "octen-test-key", // pragma: allowlist secret
    });
    const result = await setupSearch(cfg, runtime, prompter);
    expect(result.tools?.web?.search?.provider).toBe("octen");
    expect(result.tools?.web?.search?.octen?.apiKey).toBe("octen-test-key");
    expect(result.tools?.web?.search?.enabled).toBe(true);
  });

  it("shows missing-key note when no key is provided and no env var", async () => {
    const original = process.env.OCTEN_API_KEY;
    delete process.env.OCTEN_API_KEY;
    try {
      const cfg: OpenClawConfig = {};
      const { prompter, notes } = createPrompter({
        selectValue: "octen",
        textValue: "",
      });
      const result = await setupSearch(cfg, runtime, prompter);
      expect(result.tools?.web?.search?.provider).toBe("octen");
      expect(result.tools?.web?.search?.enabled).toBeUndefined();
      const missingNote = notes.find((n) => n.message.includes("No API key stored"));
      expect(missingNote).toBeDefined();
    } finally {
      if (original === undefined) {
        delete process.env.OCTEN_API_KEY;
      } else {
        process.env.OCTEN_API_KEY = original;
      }
    }
  });

  it("keeps existing key when user leaves input blank", async () => {
    const result = await runBlankOctenKeyEntry(
      "existing-key", // pragma: allowlist secret
    );
    expect(result.tools?.web?.search?.octen?.apiKey).toBe("existing-key");
    expect(result.tools?.web?.search?.enabled).toBe(true);
  });

  it("advanced preserves enabled:false when keeping existing key", async () => {
    const result = await runBlankOctenKeyEntry(
      "existing-key", // pragma: allowlist secret
      false,
    );
    expect(result.tools?.web?.search?.octen?.apiKey).toBe("existing-key");
    expect(result.tools?.web?.search?.enabled).toBe(false);
  });

  it("quickstart skips key prompt when config key exists", async () => {
    const { result, prompter } = await runQuickstartOctenSetup(
      "stored-octen-key", // pragma: allowlist secret
    );
    expect(result.tools?.web?.search?.provider).toBe("octen");
    expect(result.tools?.web?.search?.octen?.apiKey).toBe("stored-octen-key");
    expect(result.tools?.web?.search?.enabled).toBe(true);
    expect(prompter.text).not.toHaveBeenCalled();
  });

  it("quickstart preserves enabled:false when search was intentionally disabled", async () => {
    const { result, prompter } = await runQuickstartOctenSetup(
      "stored-octen-key", // pragma: allowlist secret
      false,
    );
    expect(result.tools?.web?.search?.provider).toBe("octen");
    expect(result.tools?.web?.search?.octen?.apiKey).toBe("stored-octen-key");
    expect(result.tools?.web?.search?.enabled).toBe(false);
    expect(prompter.text).not.toHaveBeenCalled();
  });

  it("quickstart falls through to key prompt when no key and no env var", async () => {
    const original = process.env.OCTEN_API_KEY;
    delete process.env.OCTEN_API_KEY;
    try {
      const cfg: OpenClawConfig = {};
      const { prompter } = createPrompter({ selectValue: "octen", textValue: "" });
      const result = await setupSearch(cfg, runtime, prompter, {
        quickstartDefaults: true,
      });
      expect(prompter.text).toHaveBeenCalled();
      expect(result.tools?.web?.search?.provider).toBe("octen");
      expect(result.tools?.web?.search?.enabled).toBeUndefined();
    } finally {
      if (original === undefined) {
        delete process.env.OCTEN_API_KEY;
      } else {
        process.env.OCTEN_API_KEY = original;
      }
    }
  });

  it("quickstart skips key prompt when env var is available", async () => {
    const orig = process.env.OCTEN_API_KEY;
    process.env.OCTEN_API_KEY = "env-octen-key"; // pragma: allowlist secret
    try {
      const cfg: OpenClawConfig = {};
      const { prompter } = createPrompter({ selectValue: "octen" });
      const result = await setupSearch(cfg, runtime, prompter, {
        quickstartDefaults: true,
      });
      expect(result.tools?.web?.search?.provider).toBe("octen");
      expect(result.tools?.web?.search?.enabled).toBe(true);
      expect(prompter.text).not.toHaveBeenCalled();
    } finally {
      if (orig === undefined) {
        delete process.env.OCTEN_API_KEY;
      } else {
        process.env.OCTEN_API_KEY = orig;
      }
    }
  });

  it("stores env-backed SecretRef when secretInputMode=ref for octen", async () => {
    const cfg: OpenClawConfig = {};
    const { prompter } = createPrompter({ selectValue: "octen" });
    const result = await setupSearch(cfg, runtime, prompter, {
      secretInputMode: "ref", // pragma: allowlist secret
    });
    expect(result.tools?.web?.search?.provider).toBe("octen");
    expect(result.tools?.web?.search?.octen?.apiKey).toEqual({
      source: "env",
      provider: "default",
      id: "OCTEN_API_KEY",
    });
    expect(prompter.text).not.toHaveBeenCalled();
  });

  it("stores plaintext key when secretInputMode is unset", async () => {
    const cfg: OpenClawConfig = {};
    const { prompter } = createPrompter({
      selectValue: "octen",
      textValue: "octen-plain-key", // pragma: allowlist secret
    });
    const result = await setupSearch(cfg, runtime, prompter);
    expect(result.tools?.web?.search?.octen?.apiKey).toBe("octen-plain-key");
  });

  it("exports octen provider in SEARCH_PROVIDER_OPTIONS", () => {
    expect(SEARCH_PROVIDER_OPTIONS).toHaveLength(1);
    const values = SEARCH_PROVIDER_OPTIONS.map((e) => e.value);
    expect(values).toEqual(["octen"]);
  });
});
