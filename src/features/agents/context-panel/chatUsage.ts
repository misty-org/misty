import type { MessageUsage } from "../conversations/state/conversationTypes";

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
