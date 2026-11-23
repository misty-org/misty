import { changeDocument, readDocument, RunStateError } from "./documents";
import type { RunContextOfChat as RunContext } from "../run_contexts";

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

export function notebookKey(runId: string, context: RunContext): string {
  const key = context.notebookKey?.trim();
  if (key) return key;
  return context.conversationId ? `conversation:${context.conversationId}` : `invocation:${runId}`;
}

export const readNotebook = (account: string, key: string) =>
  readDocument<Notebook>(account, "notebook", key, () => blank(key));

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
