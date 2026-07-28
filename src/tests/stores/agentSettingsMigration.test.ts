import { describe, expect, it } from "vitest";
import { selectAgentPreferences } from "@/stores/app/useSettingsStore";

// selectAgentPreferences is fail-closed: a missing section reads as
// enabled: false, which surfaces as "Agents are disabled" in the UI. The
// settings section was renamed from "assistant" to "agent", so every user who
// enabled Agents before the rename still has a document keyed "assistant"
// until they next save. Reading only the new key would silently switch Agents
// off for all of them.
describe("agent settings section rename", () => {
  it("reads a pre-rename document stored under the assistant key", () => {
    expect(
      selectAgentPreferences({
        assistant: { enabled: true, scopes: { files_allowed: true } },
      }),
    ).toEqual({
      enabled: true,
      scopes: { filesAllowed: true, cleanupAllowed: false, searchAllowed: false },
    });
  });

  it("reads a document stored under the current agent key", () => {
    expect(
      selectAgentPreferences({
        agent: { enabled: true, scopes: { cleanup_allowed: true, search_allowed: true } },
      }),
    ).toEqual({
      enabled: true,
      scopes: { filesAllowed: false, cleanupAllowed: true, searchAllowed: true },
    });
  });

  it("prefers the current key when a stale assistant section is still present", () => {
    expect(
      selectAgentPreferences({
        agent: { enabled: false },
        assistant: { enabled: true },
      }).enabled,
    ).toBe(false);
  });

  it("stays disabled when neither section exists", () => {
    expect(selectAgentPreferences({}).enabled).toBe(false);
    expect(selectAgentPreferences(null).enabled).toBe(false);
    expect(selectAgentPreferences(undefined).enabled).toBe(false);
  });
});
