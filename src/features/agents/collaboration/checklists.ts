import type { AgentChecklist, ChecklistItem } from "./types";

const keep = 20;

/**
 * Adds or replaces one run's checklist. A replayed or late copy with an older
 * version is dropped, so a reconnect never moves the checklist backwards.
 */
export function upsertChecklist(list: AgentChecklist[], incoming: AgentChecklist) {
  const current = list.find((item) => item.invocationId === incoming.invocationId);
  if (current && current.version >= incoming.version) return list;
  return [incoming, ...list.filter((item) => item.invocationId !== incoming.invocationId)].slice(
    0,
    keep,
  );
}

/** A run's checklist and the checklists of the runs it delegated to, oldest first. */
export function checklistForInvocation(list: AgentChecklist[], invocationId?: string) {
  const checklist = invocationId
    ? list.find((item) => item.invocationId === invocationId && !item.parentInvocationId)
    : undefined;
  const children = checklist
    ? list
        .filter((item) => item.parentInvocationId === checklist.invocationId)
        .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
    : [];
  return { checklist, children };
}

/**
 * Children nest under the parent's delegated steps in order; any extra
 * children nest under the last delegated step.
 */
export function nestChildren(items: ChecklistItem[], children: AgentChecklist[]) {
  const delegated = items.filter((item) => item.delegated).map((item) => item.id);
  const nested = new Map<string, AgentChecklist[]>();
  children.forEach((child, index) => {
    const step = delegated[Math.min(index, delegated.length - 1)];
    if (step) nested.set(step, [...(nested.get(step) ?? []), child]);
  });
  return nested;
}

/** "3 of 6 · Editing tests": finished steps, and the step in progress. */
export function checklistSummary(items: ChecklistItem[], activeLabel?: string) {
  const finished = items.filter((item) => item.status === "done" || item.status === "skipped");
  const active = items.find((item) => item.status === "in_progress");
  const head = `${finished.length} of ${items.length}`;
  if (active) return `${head} · ${activeLabel ? `${activeLabel}: ` : ""}${active.title}`;
  return finished.length === items.length ? `${head} · Done` : head;
}
