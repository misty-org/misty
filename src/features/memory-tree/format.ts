import { type MemoryNode } from "./model";

const day = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

/** "2:14 PM" today, "Oct 20, 2:14 PM" before. */
export function formatWhen(iso: string | undefined, now = new Date()): string {
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const sameDay = at.toDateString() === now.toDateString();
  return sameDay ? time.format(at) : `${day.format(at)}, ${time.format(at)}`;
}

/** The second line of a node: what it holds, or when and where it happened. */
export function nodeSubtitle(node: MemoryNode): string {
  if (node.type === "branch" || node.type === "group") {
    const count = `${node.count.toLocaleString()} ${node.count === 1 ? "memory" : "memories"}`;
    return node.detail && node.type === "group" ? `${node.detail} · ${count}` : count;
  }
  return node.detail ?? "";
}
