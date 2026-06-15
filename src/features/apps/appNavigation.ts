import { create } from "zustand";
import type { MistyNavigationItem } from "@misty/sdk";
import type { AppRpcIdentity, AppRpcScope } from "./rpc/session";

export interface AppNavigationRegistration {
  readonly identity: AppRpcIdentity;
  readonly items: readonly MistyNavigationItem[];
  readonly owner: symbol;
}
export const useAppNavigationStore = create<{ entries: readonly AppNavigationRegistration[] }>(
  () => ({ entries: [] }),
);

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
