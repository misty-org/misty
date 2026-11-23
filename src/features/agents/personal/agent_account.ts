import { useUserStore } from "@/features/account/core";
import { invoke } from "@/native/invoke";
import { hasTauriInternals } from "@/shared/platform/tauri";

export const agentAccountId = (): string => {
  const { me, accountId } = useUserStore.getState();
  return me?.id || accountId;
};

export const isSignedIn = (): boolean => Boolean(useUserStore.getState().me?.id);

export const useAgentAccountId = (): string =>
  useUserStore((state) => state.me?.id || state.accountId);

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
  } catch {}
}

const adopting = new Set<string>();

export async function adoptSignedOutAgents(account: string): Promise<number> {
  if (!account || account === signedOutAgentAccount || !hasTauriInternals()) return 0;
  if (adopting.size || adoptedBefore()) return 0;
  adopting.add(account);
  return invoke<number>("agent_chats_adopt", { from: signedOutAgentAccount, to: account })
    .then((moved) => {
      noteAdopted();
      return moved;
    })
    .catch(() => 0)
    .finally(() => adopting.delete(account));
}

let telling = false;

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
