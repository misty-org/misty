import { agentAccountId } from "../../personal/agent_account";
import { localDocuments } from "../../conversations/state/local_chats";

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

let currentAccount = "";

export function setRunStateAccount(account: string) {
  currentAccount = account;
}

export function runStateAccount(): string {
  return currentAccount || agentAccountId();
}
