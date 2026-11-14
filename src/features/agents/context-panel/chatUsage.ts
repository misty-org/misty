import type { GlobalAiMessage, MessageUsage } from "../conversations/state/conversationTypes";

/** A chat's usage as the session card shows it: the latest reply's, and the whole chat's. */
export interface ChatUsage {
  /** Tokens the context held at the latest report, and the model's window. */
  used?: number;
  window?: number;
  /** The latest reply's buckets; they don't overlap. */
  last?: MessageUsage;
  /** Of the latest reply's prompt, the share read from the engine's cache. */
  cacheHit?: number;
  /** Every reply's tokens added up: what went in (cached or not) and what came out. */
  totalIn: number;
  totalOut: number;
  /** What the replies that reported a cost cost, added up; undefined when none did. */
  costUsd?: number;
  replies: number;
}

const count = (value: number | undefined) => (typeof value === "number" && value > 0 ? value : 0);

/** Adds up a chat's saved usage reports, oldest first. Each reply's report is that reply's own. */
export function chatUsage(usages: Array<MessageUsage | undefined>): ChatUsage {
  const summary: ChatUsage = { totalIn: 0, totalOut: 0, replies: 0 };
  for (const usage of usages) {
    if (!usage) continue;
    const input = count(usage.input) + count(usage.cacheRead) + count(usage.cacheWrite);
    const output = count(usage.output);
    // None used is a compaction the engine didn't size, so an earlier reply's count is stale.
    if (usage.used === 0) summary.used = undefined;
    if (!input && !output && !usage.used) continue;
    summary.replies += 1;
    summary.totalIn += input;
    summary.totalOut += output;
    if (typeof usage.costUsd === "number" && usage.costUsd >= 0)
      summary.costUsd = (summary.costUsd ?? 0) + usage.costUsd;
    if (usage.used) summary.used = usage.used;
    if (usage.window) summary.window = usage.window;
    if (input || output) {
      summary.last = usage;
      summary.cacheHit = input ? count(usage.cacheRead) / input : undefined;
    }
  }
  return summary;
}

/** Dollars as people read them: cents when under a dollar's worth matters, never a long tail. */
export function formatCost(dollars: number): string {
  if (dollars > 0 && dollars < 0.01) return "<$0.01";
  return `$${dollars.toFixed(2)}`;
}

/** The chat's turns as the session card's turn stats show them. */
export interface TurnStats {
  /** Replies that finished, and those that failed or were stopped. */
  finished: number;
  stopped: number;
  /** The latest finished reply's run time and its tokens; absent when no reply said. */
  lastMs?: number;
  averageMs?: number;
  longestMs?: number;
  lastIn?: number;
  lastOut?: number;
  /** Of the latest reply's output, the tokens spent reasoning. */
  lastReasoning?: number;
  /** What a reply that reported a cost cost on average. */
  averageCostUsd?: number;
}

/** Adds up a chat's replies, oldest first, for the turn stats. */
export function turnStats(messages: readonly GlobalAiMessage[]): TurnStats {
  const stats: TurnStats = { finished: 0, stopped: 0 };
  let timed = 0;
  let totalMs = 0;
  let costed = 0;
  let totalCost = 0;
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    if (message.state === "failed" || message.state === "canceled") stats.stopped += 1;
    else if (message.state === "completed" || message.state === undefined) stats.finished += 1;
    else continue;
    if (message.durationMs && message.durationMs > 0) {
      timed += 1;
      totalMs += message.durationMs;
      stats.lastMs = message.durationMs;
      stats.longestMs = Math.max(stats.longestMs ?? 0, message.durationMs);
    }
    const usage = message.usage;
    if (usage) {
      const input = count(usage.input) + count(usage.cacheRead) + count(usage.cacheWrite);
      const output = count(usage.output);
      if (input || output) {
        stats.lastIn = input;
        stats.lastOut = output;
        stats.lastReasoning = count(usage.reasoning) || undefined;
      }
      if (typeof usage.costUsd === "number" && usage.costUsd >= 0) {
        costed += 1;
        totalCost += usage.costUsd;
      }
    }
  }
  if (timed) stats.averageMs = totalMs / timed;
  if (costed) stats.averageCostUsd = totalCost / costed;
  return stats;
}
