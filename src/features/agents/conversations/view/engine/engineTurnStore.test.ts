import { describe, expect, it } from "vitest";
import type { AiInvocationEvent } from "../../../runs/invocations/invocationTypes";
import { reduceEngineTurn, type EngineTurn } from "./engineTurnStore";

const blank: EngineTurn = {
  thinking: "",
  answering: false,
  asks: [],
  todos: [],
  planDraft: "",
  compacting: false,
  background: 0,
  subagents: [],
  tools: {},
  ended: false,
};

const run = (events: Array<Record<string, unknown>>) =>
  events.reduce(
    (turn, event, index) =>
      reduceEngineTurn(turn, { id: `e${index}`, ...event } as unknown as AiInvocationEvent),
    blank,
  );

describe("engine turn", () => {
  it("folds the thinking once the answer starts", () => {
    const turn = run([
      { type: "thinking.delta", delta: "Let me look." },
      { type: "response.delta", delta: "Done" },
    ]);
    expect(turn.thinking).toBe("Let me look.");
    expect(turn.answering).toBe(true);
  });

  it("keeps a question until it is settled", () => {
    const turn = run([
      { type: "engine.question", requestId: "q1", questions: [] },
      { type: "engine.question_settled", requestId: "q1" },
    ]);
    expect(turn.asks).toEqual([{ requestId: "q1", questions: [], settled: true }]);
  });

  it("applies todo snapshots and patches", () => {
    const turn = run([
      {
        type: "engine.todos",
        replace: true,
        items: [{ content: "a", status: "active" }, { content: "b" }],
      },
      { type: "engine.todos", replace: false, items: [{ content: "a", status: "complete" }] },
    ]);
    expect(turn.todos.map((todo) => todo.status)).toEqual(["complete", undefined]);
  });

  it("nests a sub-agent's rows under the Task that started it", () => {
    const turn = run([
      { type: "tool.started", toolCallId: "task", toolName: "Task" },
      {
        type: "tool.detail",
        toolCallId: "task",
        toolName: "Task",
        activity: { input: { description: "Find the bug" } },
      },
      { type: "tool.started", toolCallId: "read", toolName: "Read", parentToolCallId: "task" },
      { type: "tool.completed", toolCallId: "read", toolName: "Read" },
      { type: "tool.completed", toolCallId: "task", toolName: "Task" },
    ]);
    expect(turn.subagents).toHaveLength(1);
    expect(turn.subagents[0]).toMatchObject({ goal: "Find the bug", state: "completed" });
    expect(turn.subagents[0].rows).toEqual([{ id: "read", name: "Read", state: "completed" }]);
  });

  it("settles everything when the run ends", () => {
    const turn = run([
      { type: "engine.question", requestId: "q1", questions: [] },
      { type: "engine.compaction", active: true },
      { type: "invocation.canceled", state: "canceled" },
    ]);
    expect(turn.ended).toBe(true);
    expect(turn.compacting).toBe(false);
    expect(turn.asks[0].settled).toBe(true);
  });
});
