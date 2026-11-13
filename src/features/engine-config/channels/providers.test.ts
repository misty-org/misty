// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

import { describe, expect, it } from "vitest";
import { providerEntries, stripConventionEnv } from "./providers";

describe("stripConventionEnv", () => {
  it("keeps CODEBUDDY_INTERNET_ENVIRONMENT when editing an env-configured channel", () => {
    // A hand-edited channel (or a future cc-switch import) carries this key;
    // the channel form has no field for it, so stripping it would lose the
    // enterprise environment on any edit (the backend cannot derive it for
    // custom domains, and the wrong environment 401s per official docs).
    const stripped = stripConventionEnv("codebuddy", {
      env: { CODEBUDDY_INTERNET_ENVIRONMENT: "cloudhosted" },
      settingsConfig: {
        env: {
          CODEBUDDY_BASE_URL: "https://company.copilot.qq.com",
          CODEBUDDY_API_KEY: "sk-x",
          CODEBUDDY_INTERNET_ENVIRONMENT: "cloudhosted",
        },
      },
    });
    expect(stripped.env).toEqual({ CODEBUDDY_INTERNET_ENVIRONMENT: "cloudhosted" });
    expect(stripped.settingsConfig).toEqual({
      env: { CODEBUDDY_INTERNET_ENVIRONMENT: "cloudhosted" },
    });
  });
});

describe("providerEntries", () => {
  it("lists channels in saved order with whether a key is saved, never the key", () => {
    const entries = providerEntries("codex", {
      channels: [
        {
          id: "b",
          hasKey: true,
          config: {
            name: "Relay",
            settingsConfig: {
              config: 'model = "m"\n[model_providers.x]\nbase_url = "https://r.example/v1"',
            },
          },
        },
        { id: "a", hasKey: false, config: { baseUrl: "https://a.example" } },
      ],
    });
    expect(entries.map((entry) => entry.id)).toEqual(["b", "a"]);
    expect(entries[0]).toMatchObject({
      name: "Relay",
      hasKey: true,
      baseUrl: "https://r.example/v1",
    });
    expect(entries[1]).toMatchObject({ name: "a", hasKey: false, baseUrl: "https://a.example" });
    expect(Object.keys(entries[0])).not.toContain("apiKey");
  });
});
