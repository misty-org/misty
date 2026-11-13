import { localDocuments } from "../conversations/state/localChats";
import { LocalToolRejected } from "./host";

/**
 * Sub-agents (`agent_delegation_tools.go`, `agent_delegation_progress.go`). `agent.delegate` starts up
 * to three child runs under the parent's agent and modes, never more, and with a browser the parent's
 * computer opens a tab per child and signs that child's grant. Children report into the parent's
 * notebook and return their answers here.
 */

const maxTasks = 3;
/** One call holds this long at most. `agent.wait` picks up children that run longer. */
export const holdMs = 270_000;
export const checkMs = 2_000;
export const maxAnswer = 6_000;
export const summaryLength = 240;

export interface Task {
  goal: string;
  context?: string;
  output_schema?: Record<string, unknown>;
}

export interface Child {
  callId: string;
  taskIndex: number;
  goal: string;
  outputSchema?: Record<string, unknown>;
  runId: string;
  state: string;
  answer: string;
  error: string;
}

const documentId = (parent: string) => `delegation:${parent}`;

export const invalid = (message: string) => new LocalToolRejected("invalid_request", message);

export const finished = (state: string) =>
  ["completed", "failed", "canceled", "missing"].includes(state);

export const clip = (text: string, limit: number) => {
  const characters = [...text];
  return characters.length > limit ? `${characters.slice(0, limit - 1).join("")}…` : text;
};

export async function childrenOf(account: string, parent: string): Promise<Child[]> {
  const raw = await localDocuments.get(account, "run", documentId(parent));
  return raw ? (JSON.parse(raw) as { children: Child[] }).children : [];
}

export async function saveChildren(account: string, parent: string, children: Child[]) {
  const raw = await localDocuments.get(account, "run", documentId(parent));
  await localDocuments.swap(account, "run", documentId(parent), raw, JSON.stringify({ children }));
}

export function parseTasks(input: Record<string, unknown>): { tasks: Task[]; browser: boolean } {
  const tasks = input.tasks as Task[] | undefined;
  if (!Array.isArray(tasks) || !tasks.length || tasks.length > maxTasks)
    throw invalid(`give 1–${maxTasks} tasks`);
  tasks.forEach((task, index) => {
    const goal = typeof task?.goal === "string" ? task.goal : "";
    if (!goal.trim() || goal.length > 4000 || (task.context?.length ?? 0) > 8000)
      throw invalid(`task ${index + 1} needs a goal of up to 4000 characters`);
    const schema = task.output_schema;
    if (schema && (schema.type !== "object" || JSON.stringify(schema).length > 8 << 10))
      throw invalid(`task ${index + 1}'s output_schema must be a JSON Schema with type object`);
  });
  return { tasks, browser: input.browser === undefined || input.browser === true };
}

/** Everything a child knows: it never sees the parent's conversation. */
export function delegatedPrompt(task: Task): string {
  const parts = [
    `You are a sub-agent working on one part of a larger task for the user. Finish this part ` +
      `completely on your own; there is no one to ask.\n\nGoal: ${task.goal.trim()}`,
  ];
  const context = task.context?.trim();
  if (context) parts.push(`\n\nContext:\n${context}`);
  parts.push(
    "\n\nAppend what you find, with source URLs, to the task notebook's findings with log_work_write as you go. Do not rewrite its plan.",
  );
  parts.push(
    task.output_schema
      ? `\n\nEnd with agent_finish whose summary is only a JSON object matching this schema:\n${JSON.stringify(task.output_schema)}`
      : "\n\nEnd with agent_finish: a concise answer with the facts and their sources.",
  );
  return parts.join("");
}

export const viewLabel = (goal: string) =>
  clip(goal.split(/\s+/).filter(Boolean).slice(0, 4).join(" "), 32);

/** Tabs for the children, in the parent's browser. Without one that can open them, they work without. */

export * from "./delegationRuns";
