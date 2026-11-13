import { expect, it, vi } from "vitest";

vi.mock("../invocations/invocationSubscription", () => ({
  readRunFollow: vi.fn(),
  readRunState: vi.fn(),
}));

import type { AiInvocationEvent } from "../invocations/invocationTypes";
import { progressOf } from "./runState";

it("rebuilds a reply's timeline from what its run kept", () => {
  const events = [
    { id: "1", type: "tool.started", toolCallId: "c1", toolName: "web.fetch" },
    { id: "2", type: "tool.completed", toolCallId: "c1", toolName: "web.fetch" },
    { id: "3", type: "tool.started", toolCallId: "c2", toolName: "shell.run" },
    { id: "4", type: "notebook.updated", notebook: { plan: "p", findings: "f" } },
    { id: "5", type: "delegation.updated", delegation: { children: [] } },
  ] as unknown as AiInvocationEvent[];
  const progress = progressOf(events);
  expect(progress.items.map((item) => item.type === "tool" && [item.id, item.state])).toEqual([
    ["c1", "completed"],
    // A run that's over has nothing still running.
    ["c2", expect.not.stringMatching("running")],
  ]);
  expect(progress.notebook).toEqual({ plan: "p", findings: "f" });
  expect(progress.subagents).toEqual([]);
});
