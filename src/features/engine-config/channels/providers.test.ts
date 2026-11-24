// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

import { describe, expect, it } from "vitest";
import { providerEntries, stripConventionEnv } from "./providers";

describe("stripConventionEnv", () => {
  it("keeps an engine's other env keys when editing an env-configured channel", () => {
    const stripped = stripConventionEnv("claude", {
      env: { NO_PROXY: "localhost" },
      settingsConfig: {
        env: {
          ANTHROPIC_BASE_URL: "https://relay.example",
          ANTHROPIC_AUTH_TOKEN: "sk-x",
          NO_PROXY: "localhost",
        },
      },
    });
    expect(stripped.env).toEqual({ NO_PROXY: "localhost" });
    expect(stripped.settingsConfig).toEqual({ env: { NO_PROXY: "localhost" } });
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
