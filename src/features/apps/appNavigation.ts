import { persist } from "zustand/middleware";
import { create } from "zustand";
import type { MistyNavigationItem } from "@misty/sdk";
import type { AppRpcIdentity, AppRpcScope } from "./rpc/session";

export interface AppNavigationRegistration {
  readonly identity: AppRpcIdentity;
  readonly items: readonly MistyNavigationItem[];
  readonly owner: symbol;
}
type ProviderNavigationCache = {
  identity: Pick<AppRpcIdentity, "accountId" | "spaceId" | "appId">;
  items: readonly MistyNavigationItem[];
};
export const useAppNavigationStore = create<{
  entries: readonly AppNavigationRegistration[];
  providerCache: readonly ProviderNavigationCache[];
}>()(
  persist(
    () => ({
      entries: [] as readonly AppNavigationRegistration[],
      providerCache: [] as readonly ProviderNavigationCache[],
    }),
    {
      name: "misty-provider-navigation-v1",
      partialize: (state) => ({ providerCache: state.providerCache }),
    },
  ),
);
export function savedProviderNavigation(
  entries: readonly ProviderNavigationCache[],
  identity: Pick<AppRpcIdentity, "accountId" | "spaceId" | "appId">,
) {
  return entries.find(
    (entry) =>
      entry.identity.accountId === identity.accountId &&
      entry.identity.spaceId === identity.spaceId &&
      entry.identity.appId === identity.appId,
  );
}

/** Registrations belong to one mounted instance, never to an unscoped app ID. */
export function createAppNavigationRegistration(scope: AppRpcScope) {
  const owner = Symbol(scope.identity.instanceId);
  const close = () =>
    useAppNavigationStore.setState((state) => ({
      entries: state.entries.filter((entry) => entry.owner !== owner),
    }));
  scope.signal.addEventListener("abort", close, { once: true });
  return {
    setItems(items: readonly MistyNavigationItem[]) {
      scope.assert("navigation.write");
      const copy = structuredClone(items);
      useAppNavigationStore.setState((state) => ({
        ...(["browser", "chat", "inbox", "planner", "journal", "library"].includes(scope.identity.appId)
          ? {
              providerCache: [
                ...state.providerCache.filter(
                  (entry) =>
                    !(
                      entry.identity.accountId === scope.identity.accountId &&
                      entry.identity.spaceId === scope.identity.spaceId &&
                      entry.identity.appId === scope.identity.appId
                    ),
                ),
                {
                  identity: {
                    accountId: scope.identity.accountId,
                    spaceId: scope.identity.spaceId,
                    appId: scope.identity.appId,
                  },
                  items: copy,
                },
              ].slice(-100),
            }
          : {}),
        entries: [
          ...state.entries.filter((entry) => entry.owner !== owner),
          ...(copy.length ? [{ owner, identity: scope.identity, items: copy }] : []),
        ],
      }));
    },
    close,
  };
}

export function appNavigationFor(
  entries: readonly AppNavigationRegistration[],
  identity: { accountId: string; spaceId?: string; appId: string; instanceId?: string },
) {
  const matching = entries.filter(
    (entry) =>
      entry.identity.accountId === identity.accountId &&
      entry.identity.spaceId === identity.spaceId &&
      entry.identity.appId === identity.appId,
  );
  return (
    matching.find((entry) => entry.identity.instanceId === identity.instanceId) ??
    matching[matching.length - 1]
  );
}
