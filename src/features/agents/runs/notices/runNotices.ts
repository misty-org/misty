import type { MistyActivityEntry } from "../../conversations/state/activity";
import type { AiInvocationEvent } from "../invocations/invocationTypes";

/**
 * When a run is worth telling its person about while they're away: it finished, it failed, or it
 * stopped to ask them something. A run says each once, and asks again only after it works again.
 */
export type RunNoticeKind = "finished" | "failed" | "needs-you";

export type NoticeRun = Pick<
  MistyActivityEntry,
  | "run_id"
  | "state"
  | "conversation_id"
  | "agent_id"
  | "parent_run_id"
  | "delegation_depth"
  | "updated_at"
>;

export interface RunNotice {
  runId: string;
  kind: RunNoticeKind;
  conversationId: string;
  agentId: string;
}

/** What a run's events say that its state doesn't: it asked something, or ended on a hand-off. */
type Hint = "asking" | "handoff";

/** Tool results that end a run on something the person must do: approve, answer, review a plan. */
const HANDOFF_STATUSES = new Set(["awaiting_answer", "awaiting_approval", "plan_proposed"]);
const ASKING_PHASES = new Set(["awaiting_approval", "awaiting_intervention", "awaiting_input"]);
/** Events that show a run moved on from a question, so a later one counts again. */
const MOVED_ON = new Set([
  "engine.question_settled",
  "engine.plan_settled",
  "response.delta",
  "thinking.delta",
  "user.steering",
]);
/** Events that start a run working again, which also forget a hand-off. */
const STARTED = new Set(["invocation.started", "run.started", "tool.started"]);

function statusOf(result: unknown): string {
  let value = result;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return "";
    }
  }
  if (!value || typeof value !== "object") return "";
  const status = (value as { status?: unknown }).status;
  return typeof status === "string" ? status : "";
}

/** The notice a run's state and hint call for, or null while it works or once it was canceled. */
export function noticeKindOf(state: string, hint?: Hint): RunNoticeKind | null {
  if (state === "awaiting_approval" || state === "awaiting_intervention") return "needs-you";
  if (state === "failed") return "failed";
  if (state === "completed") return hint ? "needs-you" : "finished";
  if (state === "running" || state === "queued" || state === "awaiting_device")
    return hint === "asking" ? "needs-you" : null;
  return null;
}

/**
 * Follows runs and says which changed into something to notice. The first look only records what's
 * there, so opening Misty never announces runs that ended before it.
 */
export class RunNoticeTracker {
  private readonly hints = new Map<string, Hint>();
  private readonly told = new Map<string, RunNoticeKind | null>();
  private seeded = false;

  /** `since`: a run missing from the first look counts only if it changed after this time. */
  constructor(private readonly since = Date.now()) {}

  /** Reads one of a run's events for a question or hand-off its state can't show. */
  noteEvent(runId: string, event: AiInvocationEvent): void {
    // Outside engines add their own kinds, so this reads events by name.
    const loose = event as unknown as Record<string, unknown>;
    const kind = String(loose.type ?? "");
    const review = loose.review as { status?: unknown } | undefined;
    const phase = typeof loose.phase === "string" ? loose.phase : "";
    if (
      kind === "engine.question" ||
      kind === "approval.required" ||
      (kind === "engine.plan_review" && review?.status === "awaiting_review") ||
      (kind === "assistant.status" && ASKING_PHASES.has(phase))
    ) {
      this.hints.set(runId, "asking");
      return;
    }
    if (kind === "tool.completed" && HANDOFF_STATUSES.has(statusOf(loose.result))) {
      this.hints.set(runId, "handoff");
      return;
    }
    const started = STARTED.has(kind);
    const movedOn =
      MOVED_ON.has(kind) ||
      (kind === "assistant.status" && phase !== "" && !phase.startsWith("awaiting"));
    if (started || (movedOn && this.hints.get(runId) === "asking")) {
      this.hints.delete(runId);
      if (this.told.get(runId) === "needs-you") this.told.set(runId, null);
    }
  }

  /** Compares each chat's newest top-level run with what was last said about it. */
  update(entries: readonly NoticeRun[]): RunNotice[] {
    const newest = new Map<string, NoticeRun>();
    for (const entry of entries) {
      // Sub-agents report through the run that started them.
      if (entry.parent_run_id || entry.delegation_depth > 0 || !entry.conversation_id) continue;
      const known = newest.get(entry.conversation_id);
      if (!known || entry.updated_at > known.updated_at) newest.set(entry.conversation_id, entry);
    }
    const notices: RunNotice[] = [];
    for (const entry of newest.values()) {
      const kind = noticeKindOf(entry.state, this.hints.get(entry.run_id));
      const before = this.told.get(entry.run_id);
      this.told.set(entry.run_id, kind);
      if (!this.seeded || !kind || kind === before) continue;
      // A run first seen now that last changed before Misty was looking is old news.
      if (before === undefined && !(Date.parse(entry.updated_at) >= this.since)) continue;
      notices.push({
        runId: entry.run_id,
        kind,
        conversationId: entry.conversation_id,
        agentId: entry.agent_id ?? "",
      });
    }
    this.seeded = true;
    return notices;
  }
}

/** The notice's title: the agent's name and what happened. */
export function noticeTitle(agentName: string, kind: RunNoticeKind): string {
  const name = agentName.trim() || "Your agent";
  if (kind === "failed") return `${name} failed`;
  if (kind === "needs-you") return `${name} needs you`;
  return `${name} finished`;
}

/** The chat's address on the Agents page. */
export function noticeRoute(agentId: string, conversationId: string): string {
  const query = new URLSearchParams();
  if (agentId) query.set("agent", agentId);
  query.set("conversation", conversationId);
  return `/agents?${query.toString()}`;
}
