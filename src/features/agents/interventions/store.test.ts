import { beforeEach, expect, it, vi } from "vitest";
import type { AgentInterventionWait } from "./api";

const waits = vi.hoisted(() => ({
  held: [] as AgentInterventionWait[],
  decided: [] as [string, boolean][],
  changed: undefined as undefined | (() => void),
}));

vi.mock("./localWaits", () => ({
  listenForLocalWaits: () => undefined,
  localWaits: () => waits.held,
  decideLocalWait: (id: string, ready: boolean) => waits.decided.push([id, ready]),
  onLocalWaitsChanged: (listener: () => void) => {
    waits.changed = listener;
    return () => undefined;
  },
}));

import { useAgentInterventions } from "./store";

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
  waits.held = [];
  waits.decided = [];
  useAgentInterventions.getState().setAccount("");
});

it("shows what this computer is holding and follows changes to it", async () => {
  useAgentInterventions.getState().setAccount("me");
  const first = wait();
  waits.held = [first];
  waits.changed?.();
  expect(useAgentInterventions.getState().items.map((item) => item.id)).toEqual([first.id]);
  const seenAt = useAgentInterventions.getState().items[0]?.observedAt;
  await useAgentInterventions.getState().refresh();
  expect(useAgentInterventions.getState().items[0]?.observedAt).toBe(seenAt);
});

it("answers a wait once, for the account that holds it", async () => {
  useAgentInterventions.getState().setAccount("me");
  const held = wait();
  waits.held = [held];
  await useAgentInterventions.getState().refresh();
  await expect(useAgentInterventions.getState().decide("other", held.id, true)).resolves.toBe(
    false,
  );
  await expect(useAgentInterventions.getState().decide("me", held.id, true)).resolves.toBe(true);
  expect(waits.decided).toEqual([[held.id, true]]);
  expect(useAgentInterventions.getState().items).toEqual([]);
  await expect(useAgentInterventions.getState().decide("me", held.id, true)).resolves.toBe(false);
});
