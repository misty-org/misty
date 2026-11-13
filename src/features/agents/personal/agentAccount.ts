import { useUserStore } from "@/features/account/core";
import { invoke } from "@/native/invoke";
import { hasTauriInternals } from "@/shared/platform/tauri";

/**
 * Whose agents these are, for everything kept in misty.db by account. Agents need no account, so signed
 * out they file under this fixed scope; an account that signs in on this computer can take over what's
 * there once its person agrees (`adoptSignedOutAgents`), so signing in need lose no chat.
 */
const signedOutAgentAccount = "local";

export const agentAccountId = (): string => useUserStore.getState().me?.id ?? signedOutAgentAccount;

export const isSignedIn = (): boolean => Boolean(useUserStore.getState().me?.id);

/** The same, for a component: it changes as the person signs in and out. */
export const useAgentAccountId = (): string =>
  useUserStore((state) => state.me?.id ?? signedOutAgentAccount);

const adopting = new Set<string>();

/**
 * What was kept signed out becomes the account's own if the person says so: native code asks in the
 * island first when there's anything to hand over, and resolves with how many rows moved. On a shared
 * computer it may be someone else's, so saying no leaves it where it is.
 */
export async function adoptSignedOutAgents(account: string): Promise<number> {
  if (account === signedOutAgentAccount || !hasTauriInternals() || adopting.has(account)) return 0;
  adopting.add(account);
  // On failure the chats stay where they are, and the next load tries again.
  return invoke<number>("agent_chats_adopt", { from: signedOutAgentAccount, to: account })
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
