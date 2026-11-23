import { create } from "zustand";
import { readRunFollow } from "../../../runs/invocations/invocation_subscription";
import { watchAllRunEvents } from "../../../runs/local-run/local_run_events";
import type {
  AiInvocationEvent,
  EnginePlanReview,
  EngineQuestion,
  EngineTodo,
} from "../../../runs/invocations/invocation_types";

export interface EngineAsk {
  requestId: string;
  questions: EngineQuestion[];
  settled: boolean;
}

export interface EngineChildRow {
  id: string;
  name: string;
  state: "running" | "completed" | "failed";
  detail?: string;
}

export interface EngineSubagent {
  id: string;
  name: string;
  goal: string;
  state: "running" | "completed" | "failed";
  rows: EngineChildRow[];
}

export interface EngineTurn {
  thinking: string;
  answering: boolean;
  asks: EngineAsk[];
  todos: EngineTodo[];
  planDraft: string;
  plan?: EnginePlanReview;
  compacting: boolean;
  retry?: { attempt: number; max: number; message: string };
  model?: string;
  effort?: string;
  background: number;
  subagents: EngineSubagent[];
  tools: Record<string, { name: string; goal: string }>;
  ended: boolean;
}

const blank = (): EngineTurn => ({
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
});

interface EngineTurnState {
  byRun: Record<string, EngineTurn>;
}

export const useEngineTurnStore = create<EngineTurnState>(() => ({ byRun: {} }));

const goalOf = (input: unknown) => {
  const value = (input ?? {}) as Record<string, unknown>;
  const text = [value.description, value.prompt, value.subagent_type].find(
    (field) => typeof field === "string" && field.trim(),
  );
  return typeof text === "string" ? text : "";
};

function mergeTodos(current: EngineTodo[], items: EngineTodo[], replace: boolean): EngineTodo[] {
  if (replace) return items;
  const next = [...current];
  for (const item of items) {
    const index = next.findIndex(
      (existing) => (item.id && existing.id === item.id) || existing.content === item.content,
    );
    if (index < 0) next.push(item);
    else next[index] = { ...next[index], ...item, status: item.status || next[index].status };
  }
  return next;
}

export function reduceEngineTurn(turn: EngineTurn, event: AiInvocationEvent): EngineTurn {
  switch (event.type) {
    case "thinking.delta":
      return { ...turn, thinking: turn.thinking + event.delta };
    case "response.delta":
      return turn.answering && !turn.retry ? turn : { ...turn, answering: true, retry: undefined };
    case "engine.question":
      return {
        ...turn,
        asks: [
          ...turn.asks.filter((ask) => ask.requestId !== event.requestId),
          { requestId: event.requestId, questions: event.questions, settled: false },
        ],
      };
    case "engine.question_settled":
      return {
        ...turn,
        asks: turn.asks.map((ask) =>
          ask.requestId === event.requestId ? { ...ask, settled: true } : ask,
        ),
      };
    case "engine.todos":
      return { ...turn, todos: mergeTodos(turn.todos, event.items ?? [], event.replace) };
    case "engine.plan_draft":
      return { ...turn, planDraft: event.replace ? event.text : turn.planDraft + event.text };
    case "engine.plan_review":
      return { ...turn, plan: event.review, planDraft: "" };
    case "engine.plan_settled":
      return turn.plan?.planId === event.planId
        ? { ...turn, plan: { ...turn.plan, status: event.status } }
        : turn;
    case "engine.compaction":
      return { ...turn, compacting: event.active };
    case "engine.retry":
      return { ...turn, retry: { attempt: event.attempt, max: event.max, message: event.message } };
    case "engine.model":
      return {
        ...turn,
        model: event.model ?? turn.model,
        effort: event.effort ?? turn.effort,
      };
    case "engine.background":
      return { ...turn, background: event.pending };
    case "tool.started": {
      if (!event.parentToolCallId)
        return {
          ...turn,
          tools: { ...turn.tools, [event.toolCallId]: { name: event.toolName, goal: "" } },
        };
      const parent = event.parentToolCallId;
      const row: EngineChildRow = { id: event.toolCallId, name: event.toolName, state: "running" };
      const existing = turn.subagents.find((subagent) => subagent.id === parent);
      const task = turn.tools[parent];
      const subagent: EngineSubagent = existing
        ? { ...existing, state: "running", rows: [...existing.rows, row] }
        : {
            id: parent,
            name: task?.name ?? "Task",
            goal: task?.goal ?? "",
            state: "running",
            rows: [row],
          };
      return {
        ...turn,
        subagents: existing
          ? turn.subagents.map((item) => (item.id === parent ? subagent : item))
          : [...turn.subagents, subagent],
      };
    }
    case "tool.detail": {
      const detail = event.activity.detail;
      const task = turn.tools[event.toolCallId];
      const tools =
        task && !task.goal && event.activity.input !== undefined
          ? { ...turn.tools, [event.toolCallId]: { ...task, goal: goalOf(event.activity.input) } }
          : turn.tools;
      return {
        ...turn,
        tools,
        subagents: turn.subagents.map((subagent) => ({
          ...subagent,
          goal:
            subagent.id === event.toolCallId && !subagent.goal
              ? goalOf(event.activity.input)
              : subagent.goal,
          rows: subagent.rows.map((row) =>
            row.id === event.toolCallId && detail ? { ...row, detail } : row,
          ),
        })),
      };
    }
    case "tool.completed":
    case "tool.failed": {
      const state = event.type === "tool.failed" ? "failed" : "completed";
      return {
        ...turn,
        subagents: turn.subagents.map((subagent) =>
          subagent.id === event.toolCallId
            ? { ...subagent, state }
            : {
                ...subagent,
                rows: subagent.rows.map((row) =>
                  row.id === event.toolCallId ? { ...row, state } : row,
                ),
              },
        ),
      };
    }
    case "invocation.completed":
    case "invocation.failed":
    case "invocation.canceled":
      return {
        ...turn,
        ended: true,
        compacting: false,
        retry: undefined,
        asks: turn.asks.map((ask) => ({ ...ask, settled: true })),
        subagents: turn.subagents.map((subagent) =>
          subagent.state === "running"
            ? { ...subagent, state: event.type === "invocation.completed" ? "completed" : "failed" }
            : subagent,
        ),
      };
    default:
      return turn;
  }
}

const engineEvent = (type: string) =>
  type === "thinking.delta" ||
  type.startsWith("engine.") ||
  type.startsWith("tool.") ||
  type === "response.delta" ||
  type.startsWith("invocation.");

function apply(runId: string, event: AiInvocationEvent) {
  if (!engineEvent(event.type)) return;
  useEngineTurnStore.setState((state) => {
    const current = state.byRun[runId];
    if (!current && (event.type === "response.delta" || event.type.startsWith("invocation.")))
      return state;
    return { byRun: { ...state.byRun, [runId]: reduceEngineTurn(current ?? blank(), event) } };
  });
}

let watching = false;

export function watchEngineTurns() {
  if (watching) return;
  watching = true;
  try {
    watchAllRunEvents(apply);
  } catch {
    watching = false;
  }
}

const restored = new Set<string>();

export async function restoreEngineTurn(runId: string) {
  if (restored.has(runId) || useEngineTurnStore.getState().byRun[runId]) return;
  restored.add(runId);
  const follow = await readRunFollow(runId).catch(() => undefined);
  if (
    !follow?.events.some(
      (event) => event.type === "thinking.delta" || event.type.startsWith("engine."),
    )
  )
    return;
  const turn = follow.events.reduce(reduceEngineTurn, blank());
  useEngineTurnStore.setState((state) =>
    state.byRun[runId] ? state : { byRun: { ...state.byRun, [runId]: turn } },
  );
}
