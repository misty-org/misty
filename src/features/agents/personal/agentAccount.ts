import { useUserStore } from "@/features/account/core";
import { invoke } from "@/native/invoke";
import { hasTauriInternals } from "@/shared/platform/tauri";

/**
 * Whose agents these are, for everything kept in misty.db by account. A person is signed in to
 * use Misty, so this is the signed-in account, known from the saved session before the server
 * answers; with nobody signed in it is empty and nothing is kept.
 */
export const agentAccountId = (): string => {
  const { me, accountId } = useUserStore.getState();
  return me?.id || accountId;
};

export const isSignedIn = (): boolean => Boolean(useUserStore.getState().me?.id);

/** The same, for a component: it changes as the person signs in and out. */
export const useAgentAccountId = (): string =>
  useUserStore((state) => state.me?.id || state.accountId);

/** Where agents and chats were kept by earlier versions, which worked signed out. */
const signedOutAgentAccount = "local";
const adoptedKey = "misty:signed-out-agents-adopted:v1";

function adoptedBefore(): boolean {
  try {
    return window.localStorage.getItem(adoptedKey) === "1";
  } catch {
    return false;
  }
}

function noteAdopted() {
  try {
    window.localStorage.setItem(adoptedKey, "1");
  } catch {
    // Without storage the next sign-in asks again, and finds nothing left if it moved.
  }
}

const adopting = new Set<string>();

/**
 * What an earlier version kept signed out becomes the account's own, once, at the first sign-in
 * on this computer, if the person says so: native code asks in the island first when there's
 * anything to hand over, and resolves with how many rows moved. On a shared computer it may be
 * someone else's, so saying no leaves it where it is. Nothing writes there any more.
 */
export async function adoptSignedOutAgents(account: string): Promise<number> {
  if (!account || account === signedOutAgentAccount || !hasTauriInternals()) return 0;
  if (adopting.size || adoptedBefore()) return 0;
  adopting.add(account);
  // On failure the chats stay where they are, and the next load tries again.
  return invoke<number>("agent_chats_adopt", { from: signedOutAgentAccount, to: account })
    .then((moved) => {
      noteAdopted();
      return moved;
    })
    .catch(() => 0)
    .finally(() => adopting.delete(account));
}

let telling = false;

/** Tells native code which account this window is, which decides whose runs and questions reach it. */
export function startTellingNativeTheAccount() {
  if (telling || !hasTauriInternals()) return;
  telling = true;
  const tell = (account: string) =>
    void invoke("agent_window_account", { account }).catch(() => undefined);
  let current = agentAccountId();
  tell(current);
  useUserStore.subscribe(() => {
    const next = agentAccountId();
    if (next === current) return;
    current = next;
    tell(next);
  });
}
