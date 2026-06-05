import { describe, expect, it } from "vitest";
import {
  normalizeAutomationRuns,
  normalizeAutomationStructure,
  normalizeCatalogResults,
} from "./normalizeAutomationStructure";

describe("automation result normalization", () => {
  it("normalizes flow structure rows", () => {
    expect(normalizeAutomationStructure({
      flowId: "flow-1",
      displayName: "Welcome lead",
      steps: [{ name: "trigger", type: "PIECE_TRIGGER", displayName: "New lead", parentName: null, relationship: "trigger", valid: true, configStatus: "configured" }],
    })?.steps[0]).toMatchObject({ name: "trigger", displayName: "New lead", valid: true });
  });

  it("normalizes run history and catalog searches", () => {
    expect(normalizeAutomationRuns({ runs: [{ id: "run-1", flowId: "flow-1", status: "SUCCEEDED", created: "2026-08-29T00:00:00Z" }] })).toHaveLength(1);
    expect(normalizeCatalogResults({ results: [{ pieceName: "@activepieces/piece-slack", actionName: "send_channel_message", displayName: "Send channel message", connected: true }] }, "action")[0]).toMatchObject({ componentName: "send_channel_message", connected: true });
  });
});
