import type { AgentChecklist, ChecklistItem } from "../../plans/planTypes";
import { nowText, type ConversationState } from "./conversationState";
import { RunStateError } from "./documents";

/** The live checklist: the concrete steps one run is working through. A delegated run's nests under its parent's. */

const maxChecklistItems = 20;
const keepChecklists = 40;

const statuses = new Set(["pending", "in_progress", "done", "skipped", "blocked"]);
const runes = (value: string) => [...value].length;
const bytes = (value: string) => new TextEncoder().encode(value).length;

export interface ChecklistUpdate {
  id: string;
  title?: string;
  status: ChecklistItem["status"];
  note?: string;
  delegated?: boolean;
}

/** `replace` swaps the whole list; otherwise known ids change in place and new ids are appended in order. */
function mergeChecklist(
  current: ChecklistItem[],
  updates: ChecklistUpdate[],
  replace: boolean,
): ChecklistItem[] {
  const next = replace ? [] : [...current];
  for (const update of updates) {
    const id = update.id.trim();
    const title = update.title?.trim() ?? "";
    const note = update.note?.trim() ?? "";
    if (
      !id ||
      bytes(id) > 40 ||
      !statuses.has(update.status) ||
      runes(title) > 160 ||
      runes(note) > 500
    )
      throw new RunStateError("invalid");
    const position = next.findIndex((item) => item.id === id);
    const known = position >= 0 ? next[position] : undefined;
    if (!known && !title) throw new RunStateError("invalid");
    const delegated = Boolean(update.delegated || known?.delegated);
    const item: ChecklistItem = {
      id,
      title: title || known!.title,
      status: update.status,
      ...(note ? { note } : {}),
      ...(delegated ? { delegated } : {}),
    };
    if (known) next[position] = item;
    else next.push(item);
  }
  if (!next.length || next.length > maxChecklistItems) throw new RunStateError("invalid");
  return next;
}

/** Applies an update to a run's checklist, starting from `seed` when it has none. Each save bumps the version. */
export function saveChecklist(
  state: ConversationState,
  input: {
    runId: string;
    parentRunId?: string;
    seed: ChecklistItem[];
    updates: ChecklistUpdate[];
    replace: boolean;
    now: number;
  },
): { next: ConversationState; result: AgentChecklist } {
  const current = state.checklists.find((item) => item.invocationId === input.runId);
  const checklist: AgentChecklist = {
    invocationId: input.runId,
    conversationId: state.id,
    ...(input.parentRunId ? { parentInvocationId: input.parentRunId } : {}),
    items: mergeChecklist(current?.items ?? input.seed, input.updates, input.replace),
    version: (current?.version ?? 0) + 1,
    updatedAt: nowText(input.now),
  };
  return {
    next: {
      ...state,
      checklists: [
        checklist,
        ...state.checklists.filter((item) => item.invocationId !== input.runId),
      ].slice(0, keepChecklists),
    },
    result: checklist,
  };
}

export function checklistResult(checklist: AgentChecklist) {
  return {
    status: "recorded",
    version: checklist.version,
    remaining: checklist.items
      .filter((item) => item.status !== "done" && item.status !== "skipped")
      .map((item) => item.id),
  };
}
