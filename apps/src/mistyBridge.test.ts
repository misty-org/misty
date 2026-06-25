import { describe, expect, it } from "vitest";
import { fallbackTheme, pluginReadyMessage } from "./mistyBridge";

describe("plugin bridge readiness", () => {
  it("identifies the extension and protocol before context is sent", () => {
    expect(pluginReadyMessage("themes")).toEqual({
      channel: "misty-plugin",
      kind: "ready",
      pluginId: "themes",
      protocolVersion: 1,
    });
  });
  it("provides the complete semantic token contract before a host snapshot arrives", () => {
    expect(fallbackTheme.mode).toBe("dark");
    expect(Object.keys(fallbackTheme.tokens).sort()).toEqual([
      "accent", "background", "border", "borderStrong", "danger", "focus", "info", "primary", "primaryContrast", "selection", "shadow", "success", "surface", "surfaceHover", "surfaceRaised", "text", "textMuted", "textSubtle", "warning",
    ].sort());
  });
});
