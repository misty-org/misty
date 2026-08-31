import { describe, expect, it } from "vitest";
import { normalizeActivepiecesFlows } from "./normalizeFlows";

describe("normalizeActivepiecesFlows", () => {
  it("normalizes structured Activepieces flow results", () => {
    expect(
      normalizeActivepiecesFlows({
        flows: [
          { id: "flow-1", displayName: "Triage leads", status: "ENABLED", triggerType: "Webhook" },
        ],
      }),
    ).toEqual([{ id: "flow-1", name: "Triage leads", status: "enabled", trigger: "Webhook" }]);
  });

  it("falls back to JSON text content", () => {
    expect(
      normalizeActivepiecesFlows(undefined, [
        '```json\n{"data":[{"flowId":"flow-2","name":"Daily brief","status":"DISABLED"}]}\n```',
      ]),
    ).toEqual([
      { id: "flow-2", name: "Daily brief", status: "disabled", trigger: "Trigger not configured" },
    ]);
  });
});
