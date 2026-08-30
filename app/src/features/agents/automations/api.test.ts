import { apiRequest } from "@/api/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { automationsApi } from "./api";

vi.mock("@/api/client", () => ({ apiRequest: vi.fn() }));

describe("automationsApi", () => {
  beforeEach(() => vi.mocked(apiRequest).mockReset().mockResolvedValue({}));

  it("loads automation flows from Misty", async () => {
    await automationsApi.flows();
    expect(apiRequest).toHaveBeenCalledWith("/automations/flows");
  });

  it("runs an allowlisted automation tool through Misty", async () => {
    await automationsApi.callTool("ap_flow_structure", { flowId: "flow-1" });
    expect(apiRequest).toHaveBeenCalledWith("/automations/tools/ap_flow_structure", {
      method: "POST",
      body: JSON.stringify({ arguments: { flowId: "flow-1" } }),
    });
  });
});
