import { changeDocument, readDocument, RunStateError } from "./documents";
import type { RunContextOfChat as RunContext } from "../runContexts";

/**
 * The run notebook: a plan and findings that live outside the model's context, so long runs re-read
 * them after compaction and sub-agents report into them. A conversation and every sub-agent it starts
 * share one. The server also mirrored the findings to a note in the personal Space; no signed-in route
 * can write a note's text, so here they stay on this computer.
 */
interface Notebook {
  id: string;
  plan: string;
  findings: string;
  updatedAt: string;
}

const limits = { plan: 20_000, findings: 100_000 };
const notebookFull = "the notebook section is full; replace it with a shorter version";

const bytes = (value: string) => new TextEncoder().encode(value).length;
const blank = (id: string): Notebook => ({ id, plan: "", findings: "", updatedAt: "" });

/** The notebook a run writes to: its parent's for a sub-agent, else its chat's, else its own. */
export function notebookKey(runId: string, context: RunContext): string {
  const key = context.notebookKey?.trim();
  if (key) return key;
  return context.conversationId ? `conversation:${context.conversationId}` : `invocation:${runId}`;
}

export const readNotebook = (account: string, key: string) =>
  readDocument<Notebook>(account, "notebook", key, () => blank(key));

/** Replaces or appends to one section. */
export function writeNotebook(
  account: string,
  key: string,
  section: "plan" | "findings",
  content: string,
  appending: boolean,
  now: number,
): Promise<Notebook> {
  return changeDocument<Notebook, Notebook>(
    account,
    "notebook",
    key,
    () => blank(key),
    (current) => {
      const text = content.trim();
      const next =
        appending && current[section].trim()
          ? `${current[section].replace(/\n+$/, "")}\n${text}`
          : text;
      if (bytes(next) > limits[section]) throw new RunStateError("invalid", notebookFull);
      const updated = { ...current, [section]: next, updatedAt: new Date(now).toISOString() };
      return { next: updated, result: updated };
    },
  );
}
