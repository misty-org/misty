import { useEffect, useMemo } from "react";
import { create } from "zustand";

// Which handoffs this person gave to an agent or dismissed. A convenience of this device only:
// kept in localStorage by account and Space, never sent anywhere.
const keep = 500;
const scopeKey = (accountId: string, spaceId: string) => `${accountId}.${spaceId}`;
const storageKey = (scope: string) => `misty.handoffs.handled.${scope}`;

function read(scope: string): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(storageKey(scope)) ?? "[]");
    return Array.isArray(saved) ? saved.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

const useHandledStore = create<{ byScope: Record<string, string[]> }>(() => ({ byScope: {} }));

/** Marks a handoff as answered here, so it stops waiting. */
export function markHandoffHandled(accountId: string, spaceId: string, messageId: string) {
  if (!accountId) return;
  const scope = scopeKey(accountId, spaceId);
  const known = useHandledStore.getState().byScope[scope] ?? read(scope);
  if (known.includes(messageId)) return;
  const next = [...known, messageId].slice(-keep);
  useHandledStore.setState((state) => ({ byScope: { ...state.byScope, [scope]: next } }));
  try {
    localStorage.setItem(storageKey(scope), JSON.stringify(next));
  } catch {
    // Storage can be unavailable; the answer still holds for this visit.
  }
}

/** The handoffs this person already answered in a Space on this device. */
export function useHandledHandoffs(accountId: string, spaceId: string): readonly string[] {
  const scope = scopeKey(accountId, spaceId);
  const known = useHandledStore((state) => state.byScope[scope]);
  useEffect(() => {
    if (!known)
      useHandledStore.setState((state) => ({
        byScope: { ...state.byScope, [scope]: state.byScope[scope] ?? read(scope) },
      }));
  }, [known, scope]);
  return useMemo(() => known ?? read(scope), [known, scope]);
}
