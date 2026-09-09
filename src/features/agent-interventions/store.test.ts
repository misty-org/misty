import { beforeEach, expect, it, vi } from "vitest";
import { agentInterventionsApi, type AgentInterventionWait } from "./api";
import { agentInterventionActivities, useAgentInterventions } from "./store";
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  agentInterventionsApi: { list: vi.fn(), decide: vi.fn() },
}));
const wait = (): AgentInterventionWait => ({
  id: crypto.randomUUID(),
  runId: "invocation_test",
  scopeId: "original-scope",
  deviceId: "original-device",
  targetLabel: "Personal inbox",
  action: "sign_in",
  reason: "Private page details",
  state: "pending",
  expiresAt: "2099-01-01T00:00:00Z",
});
beforeEach(() => {
  useAgentInterventions.getState().setAccount("");
  vi.resetAllMocks();
});
it("does not expose a delayed response to another account", async () => {
  let finish!: (value: { waits: AgentInterventionWait[] }) => void;
  vi.mocked(agentInterventionsApi.list).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  useAgentInterventions.getState().setAccount("first");
  const pending = useAgentInterventions.getState().refresh();
  useAgentInterventions.getState().setAccount("second");
  finish({ waits: [wait()] });
  await pending;
  expect(useAgentInterventions.getState().items).toEqual([]);
  expect(useAgentInterventions.getState().accountId).toBe("second");
});
it("does not restore a decided wait when an older GET returns late", async () => {
  const item = wait();
  let finish!: (value: { waits: AgentInterventionWait[] }) => void;
  vi.mocked(agentInterventionsApi.list)
    .mockResolvedValueOnce({ waits: [item] })
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce({ waits: [] });
  vi.mocked(agentInterventionsApi.decide).mockResolvedValue({ queued: true });
  useAgentInterventions.getState().setAccount("owner");
  await useAgentInterventions.getState().refresh();
  const older = useAgentInterventions.getState().refresh();
  expect(await useAgentInterventions.getState().decide("owner", item.id, true)).toBe(true);
  finish({ waits: [item] });
  await older;
  expect(useAgentInterventions.getState().items).toEqual([]);
  expect(useAgentInterventions.getState().loading).toBe(false);
});
it("does not let a stale account submit a decision or publish its late confirmation", async () => {
  const item = wait();
  let finish!: (value: { queued: true }) => void;
  vi.mocked(agentInterventionsApi.list).mockResolvedValue({ waits: [item] });
  vi.mocked(agentInterventionsApi.decide).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  useAgentInterventions.getState().setAccount("owner");
  await useAgentInterventions.getState().refresh();
  expect(await useAgentInterventions.getState().decide("old-account", item.id, true)).toBe(false);
  expect(agentInterventionsApi.decide).not.toHaveBeenCalled();
  const pending = useAgentInterventions.getState().decide("owner", item.id, true);
  expect(await useAgentInterventions.getState().decide("owner", item.id, true)).toBe(false);
  useAgentInterventions.getState().setAccount("second");
  finish({ queued: true });
  expect(await pending).toBe(false);
  expect(useAgentInterventions.getState().items).toEqual([]);
  expect(agentInterventionsApi.decide).toHaveBeenCalledTimes(1);
});
it("removes expired attention and keeps browser content out of notification text", () => {
  const item = { ...wait(), observedAt: "2026-09-07T00:00:00Z" };
  const activities = agentInterventionActivities("owner", [
    item,
    { ...item, id: crypto.randomUUID(), expiresAt: "2000-01-01T00:00:00Z" },
  ]);
  expect(activities).toHaveLength(1);
  expect(activities[0].body).not.toContain(item.reason);
  expect(activities[0].target).toEqual({
    kind: "route",
    href: `/activity?intervention=${item.id}`,
  });
});
