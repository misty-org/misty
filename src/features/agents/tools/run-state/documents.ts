import { agentAccountId } from "../../personal/agentAccount";
import { localDocuments } from "../../conversations/state/localChats";

/** Why a change to a run's state was refused. Nothing was written. */
export class RunStateError extends Error {
  constructor(
    readonly reason: "invalid" | "conflict" | "not_found",
    message?: string,
  ) {
    super(
      message ??
        {
          invalid: "Misty couldn't save that. Check it and try again.",
          conflict: "This changed since it was shown. Look at it again and retry.",
          not_found: "That's no longer here.",
        }[reason],
    );
  }
}

type Kind = Parameters<typeof localDocuments.get>[1];

/** Long enough for two windows to settle who wrote first. */
const swapAttempts = 12;

function parsed<T>(raw: string | null, blank: () => T): T {
  if (raw === null) return blank();
  try {
    return JSON.parse(raw) as T;
  } catch {
    return blank();
  }
}

export async function readDocument<T>(
  account: string,
  kind: Kind,
  id: string,
  blank: () => T,
): Promise<T> {
  return parsed(await localDocuments.get(account, kind, id), blank);
}

/**
 * Changes one document as a single step, however many windows are changing it: `change` runs again
 * on the newer copy when another window wrote first, so it must only depend on what it's given.
 * Returning no `next` writes nothing.
 */
export async function changeDocument<T, R>(
  account: string,
  kind: Kind,
  id: string,
  blank: () => T,
  change: (current: T) => { next?: T; result: R },
): Promise<R> {
  for (let attempt = 0; attempt < swapAttempts; attempt++) {
    const raw = await localDocuments.get(account, kind, id);
    const { next, result } = change(parsed(raw, blank));
    if (next === undefined) return result;
    if (await localDocuments.swap(account, kind, id, raw, JSON.stringify(next))) return result;
  }
  throw new Error("Misty couldn't save this: another window kept changing it.");
}

/** The account the chat in this window belongs to, once one has opened. */
let currentAccount = "";

export function setRunStateAccount(account: string) {
  currentAccount = account;
}

/**
 * A run outlives its chat: one resumed after a reload or a restart has its tools called with no
 * chat open, so nothing has named the account yet.
 */
export function runStateAccount(): string {
  return currentAccount || agentAccountId();
}
