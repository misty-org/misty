import { withToolEvent } from "@/features/agents/localRun";
import { settleProgress } from "@/features/agents/localRun";
import { readRunFollow, readRunState } from "../invocations/invocationSubscription";
import type {
  AgentNotebook,
  AgentSubagent,
  AiCitation,
  AiInvocationEvent,
  AiProgressItem,
} from "../invocations/invocationTypes";

/** A run as its kept events tell it: its state, and how the reply got its answer. */

export interface RunProgress {
  items: AiProgressItem[];
  citations?: AiCitation[];
  notebook?: AgentNotebook;
  subagents?: AgentSubagent[];
}

export function progressOf(events: AiInvocationEvent[]): RunProgress {
  let message: { content: string; progress?: AiProgressItem[] } = { content: "" };
  const citations: AiCitation[] = [];
  let notebook: AgentNotebook | undefined;
  let subagents: AgentSubagent[] | undefined;
  for (const event of events) {
    if (
      event.type === "tool.started" ||
      event.type === "tool.completed" ||
      event.type === "tool.failed" ||
      event.type === "tool.detail"
    )
      message = withToolEvent(message, event);
    else if (event.type === "citation") citations.push(event.citation);
    else if (event.type === "notebook.updated") notebook = event.notebook;
    else if (event.type === "delegation.updated") subagents = event.delegation.children;
  }
  return {
    items: settleProgress(message.progress) ?? [],
    ...(citations.length ? { citations } : {}),
    ...(notebook ? { notebook } : {}),
    ...(subagents ? { subagents } : {}),
  };
}

export const localRunProgress = async (runId: string) =>
  progressOf((await readRunFollow(runId)).events);

export const localRunState = async (runId: string) => ({ state: await readRunState(runId) });
