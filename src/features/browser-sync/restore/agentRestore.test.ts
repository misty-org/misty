import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  guardPage: vi.fn(),
  pageAct: vi.fn(),
  pageControls: vi.fn(),
}));
vi.mock("@/api/client", () => ({ apiRequest: mocks.apiRequest }));
vi.mock("./native", () => ({
  guardPage: mocks.guardPage,
  pageAct: mocks.pageAct,
  pageControls: mocks.pageControls,
}));

import { agentRestore } from "./agentRestore";
import type { RestoreReport } from "./native";

const report: RestoreReport = {
  status: "partial",
  applied: 1,
  secrets: 0,
  agent_fields: [{ key: "k", label: "Size", kind: "text", value: { value: "M" } }],
  withheld: 1,
  url: "https://shop.test/checkout",
};

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  mocks.guardPage.mockResolvedValue(0);
  mocks.pageControls.mockResolvedValue([{ ref: "1", role: "field", label: "Size" }]);
  mocks.pageAct.mockResolvedValue({ ok: true });
});

it("sends only unplaced normal fields, one step at a time, until done", async () => {
  mocks.apiRequest
    .mockResolvedValueOnce({ action: { type: "type", ref: "1", value: "M" } })
    .mockResolvedValueOnce({ action: { type: "done" } });
  await expect(agentRestore("tab-1", report, () => true)).resolves.toBe("done");
  const body = JSON.parse(mocks.apiRequest.mock.calls[0][1].body);
  expect(body.goal).toEqual([{ label: "Size", kind: "text", value: { value: "M" } }]);
  expect(body.step).toBe(0);
  expect(JSON.parse(mocks.apiRequest.mock.calls[1][1].body).step).toBe(1);
  // The page is guarded during the run and released afterwards.
  expect(mocks.guardPage).toHaveBeenLastCalledWith("tab-1", false);
});

it("stops as soon as the user touches the page", async () => {
  mocks.apiRequest.mockResolvedValue({ action: { type: "click", ref: "1" } });
  mocks.guardPage.mockResolvedValueOnce(100).mockResolvedValue(200);
  await expect(agentRestore("tab-1", report, () => true)).resolves.toBe("user");
  expect(mocks.pageAct).not.toHaveBeenCalled();
});

it("gives up after the step budget", async () => {
  mocks.apiRequest.mockResolvedValue({ action: { type: "scroll", dy: 100 } });
  await expect(agentRestore("tab-1", report, () => true)).resolves.toBe("budget");
  expect(mocks.apiRequest).toHaveBeenCalledTimes(8);
});
