import type { GlobalAiMessage, MessageUsage } from "../conversations/state/conversation_types";

export interface ChatUsage {
  used?: number;
  window?: number;
  last?: MessageUsage;
  cacheHit?: number;
  totalIn: number;
  totalOut: number;
  costUsd?: number;
  replies: number;
}

const count = (value: number | undefined) => (typeof value === "number" && value > 0 ? value : 0);

export function chatUsage(usages: Array<MessageUsage | undefined>): ChatUsage {
  const summary: ChatUsage = { totalIn: 0, totalOut: 0, replies: 0 };
  for (const usage of usages) {
    if (!usage) continue;
    const input = count(usage.input) + count(usage.cacheRead) + count(usage.cacheWrite);
    const output = count(usage.output);
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

export function formatCost(dollars: number): string {
  if (dollars > 0 && dollars < 0.01) return "<$0.01";
  return `$${dollars.toFixed(2)}`;
}

export interface TurnStats {
  finished: number;
  stopped: number;
  lastMs?: number;
  averageMs?: number;
  longestMs?: number;
  lastIn?: number;
  lastOut?: number;
  lastReasoning?: number;
  averageCostUsd?: number;
}

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
