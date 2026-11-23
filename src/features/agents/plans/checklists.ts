import type { AgentChecklist, ChecklistItem } from "./plan_types";

const keep = 20;

export function upsertChecklist(list: AgentChecklist[], incoming: AgentChecklist) {
  const current = list.find((item) => item.invocationId === incoming.invocationId);
  if (current && current.version >= incoming.version) return list;
  return [incoming, ...list.filter((item) => item.invocationId !== incoming.invocationId)].slice(
    0,
    keep,
  );
}

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

export function nestChildren(items: ChecklistItem[], children: AgentChecklist[]) {
  const delegated = items.filter((item) => item.delegated).map((item) => item.id);
  const nested = new Map<string, AgentChecklist[]>();
  children.forEach((child, index) => {
    const step = delegated[Math.min(index, delegated.length - 1)];
    if (step) nested.set(step, [...(nested.get(step) ?? []), child]);
  });
  return nested;
}

export function checklistSummary(items: ChecklistItem[], activeLabel?: string) {
  const finished = items.filter((item) => item.status === "done" || item.status === "skipped");
  const active = items.find((item) => item.status === "in_progress");
  const head = `${finished.length} of ${items.length} done`;
  if (active) return `${activeLabel ? `${activeLabel}: ` : ""}${active.title}, ${head}`;
  return head;
}
