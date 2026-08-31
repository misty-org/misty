import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  DEFAULT_NAVIGATOR_APP_IDS,
  NAVIGATOR_APP_IDS,
  isNavigatorAppId,
  type NavigatorAppId,
} from "./navigatorApps";

const guestAccountKey = "guest";
export const navigatorAppsStorageKey = "misty-navigator-apps";

function accountKey(accountId: string): string {
  return accountId.trim() || guestAccountKey;
}

export interface NavigatorAppsState {
  appIdsByAccount: Record<string, NavigatorAppId[]>;
  collapsedByAccount: Record<string, boolean>;
  setAppVisible: (accountId: string, appId: NavigatorAppId, visible: boolean) => void;
  setCollapsed: (accountId: string, collapsed: boolean) => void;
  adoptGuestApps: (accountId: string) => void;
  resetApps: (accountId: string) => void;
}

export function navigatorAppIdsForAccount(
  state: Pick<NavigatorAppsState, "appIdsByAccount">,
  accountId: string,
): readonly NavigatorAppId[] {
  const saved = state.appIdsByAccount[accountKey(accountId)];
  if (!saved) return DEFAULT_NAVIGATOR_APP_IDS;
  const filtered = saved.filter(isNavigatorAppId);
  return filtered.length === saved.length ? saved : filtered;
}

export function navigatorAppsCollapsedForAccount(
  state: Pick<NavigatorAppsState, "collapsedByAccount">,
  accountId: string,
): boolean {
  return state.collapsedByAccount[accountKey(accountId)] ?? false;
}

function normalizedAppIdsByAccount(value: unknown): Record<string, NavigatorAppId[]> {
  if (!value || typeof value !== "object") return {};
  const normalized: Record<string, NavigatorAppId[]> = {};
  for (const [rawKey, rawAppIds] of Object.entries(value)) {
    if (!Array.isArray(rawAppIds)) continue;
    const selected = new Set(
      rawAppIds.filter((appId): appId is NavigatorAppId =>
        typeof appId === "string" ? isNavigatorAppId(appId) : false,
      ),
    );
    normalized[accountKey(rawKey)] = NAVIGATOR_APP_IDS.filter((appId) => selected.has(appId));
  }
  return normalized;
}

function normalizedCollapsedByAccount(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([rawKey, collapsed]) =>
      typeof collapsed === "boolean" ? [[accountKey(rawKey), collapsed] as const] : [],
    ),
  );
}

function mergePersistedNavigatorApps(
  persistedState: unknown,
  currentState: NavigatorAppsState,
): NavigatorAppsState {
  const persisted = (persistedState ?? {}) as Partial<NavigatorAppsState>;
  return {
    ...currentState,
    appIdsByAccount: normalizedAppIdsByAccount(persisted.appIdsByAccount),
    collapsedByAccount: normalizedCollapsedByAccount(persisted.collapsedByAccount),
  };
}

function migratePersistedNavigatorApps(
  persistedState: unknown,
  persistedVersion: number,
): NavigatorAppsState {
  const persisted = (persistedState ?? {}) as Partial<NavigatorAppsState>;
  const appIdsByAccount = normalizedAppIdsByAccount(persisted.appIdsByAccount);
  if (persistedVersion < 3) {
    for (const [key, appIds] of Object.entries(appIdsByAccount)) {
      const selected = new Set([...appIds, "agents" as const]);
      appIdsByAccount[key] = NAVIGATOR_APP_IDS.filter((appId) => selected.has(appId));
    }
  }
  return {
    ...persisted,
    appIdsByAccount,
    collapsedByAccount: normalizedCollapsedByAccount(persisted.collapsedByAccount),
  } as NavigatorAppsState;
}

export const useNavigatorAppsStore = create<NavigatorAppsState>()(
  persist(
    (set) => ({
      appIdsByAccount: {},
      collapsedByAccount: {},
      setAppVisible: (accountId, appId, visible) => {
        if (!isNavigatorAppId(appId)) return;
        const key = accountKey(accountId);
        set((state) => {
          const current = navigatorAppIdsForAccount(state, accountId);
          const selected = new Set(current);
          if (visible) selected.add(appId);
          else selected.delete(appId);
          return {
            appIdsByAccount: {
              ...state.appIdsByAccount,
              [key]: NAVIGATOR_APP_IDS.filter((id) => selected.has(id)),
            },
          };
        });
      },
      setCollapsed: (accountId, collapsed) =>
        set((state) => ({
          collapsedByAccount: { ...state.collapsedByAccount, [accountKey(accountId)]: collapsed },
        })),
      adoptGuestApps: (accountId) => {
        const key = accountKey(accountId);
        if (key === guestAccountKey) return;
        set((state) => {
          const guestApps = state.appIdsByAccount[guestAccountKey];
          const guestCollapsed = state.collapsedByAccount[guestAccountKey];
          if (
            state.appIdsByAccount[key] !== undefined ||
            (guestApps === undefined && guestCollapsed === undefined)
          ) {
            return state;
          }
          const appIdsByAccount = { ...state.appIdsByAccount };
          const collapsedByAccount = { ...state.collapsedByAccount };
          if (guestApps !== undefined) appIdsByAccount[key] = [...guestApps];
          if (guestCollapsed !== undefined) collapsedByAccount[key] = guestCollapsed;
          delete appIdsByAccount[guestAccountKey];
          delete collapsedByAccount[guestAccountKey];
          return { appIdsByAccount, collapsedByAccount };
        });
      },
      resetApps: (accountId) =>
        set((state) => ({
          appIdsByAccount: {
            ...state.appIdsByAccount,
            [accountKey(accountId)]: [...DEFAULT_NAVIGATOR_APP_IDS],
          },
        })),
    }),
    {
      name: navigatorAppsStorageKey,
      version: 3,
      storage: createJSONStorage(() => localStorage),
      migrate: migratePersistedNavigatorApps,
      merge: mergePersistedNavigatorApps,
      partialize: (state) => ({
        appIdsByAccount: state.appIdsByAccount,
        collapsedByAccount: state.collapsedByAccount,
      }),
    },
  ),
);
