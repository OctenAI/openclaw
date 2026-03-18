import {
  createPluginBackedWebSearchProvider,
  getScopedCredentialValue,
  setScopedCredentialValue,
} from "../../src/agents/tools/web-search-plugin-factory.js";
import { emptyPluginConfigSchema } from "../../src/plugins/config-schema.js";
import type { OpenClawPluginApi } from "../../src/plugins/types.js";

const octenPlugin = {
  id: "octen",
  name: "Octen Plugin",
  description: "Bundled Octen plugin",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    api.registerWebSearchProvider(
      createPluginBackedWebSearchProvider({
        id: "octen",
        label: "Octen Search",
        hint: "Octen AI-powered search",
        envVars: ["OCTEN_API_KEY"],
        placeholder: "octen-...",
        signupUrl: "https://octen.ai/",
        docsUrl: "https://docs.openclaw.ai/tools/web",
        autoDetectOrder: 50,
        getCredentialValue: (searchConfig) => getScopedCredentialValue(searchConfig, "octen"),
        setCredentialValue: (searchConfigTarget, value) =>
          setScopedCredentialValue(searchConfigTarget, "octen", value),
      }),
    );
  },
};

export default octenPlugin;
