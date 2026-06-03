import { useSettingsStore } from "@/features/settings";
import { isNavigatorAppId, type NavigatorAppId } from "@/features/workspace";
import { useCallback, useEffect, useRef, useState } from "react";

export type NavigatorDisclosureId = NavigatorAppId | "apps";

const guestAccountKey = "guest";
const disclosureSettingsKey = "disclosures_by_account";

type DisclosureStateByAccount = Record<string, Partial<Record<NavigatorDisclosureId, boolean>>>;

function accountKey(accountId: string): string {
  return accountId.trim() || guestAccountKey;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function navigatorDisclosureSetting(
  document: Record<string, unknown> | null | undefined,
  accountId: string,
  disclosureId: NavigatorDisclosureId,
): boolean | undefined {
  if (!document) return undefined;
  const navigation = document.navigation;
  if (!isRecord(navigation)) return undefined;
  const byAccount = navigation[disclosureSettingsKey];
  if (!isRecord(byAccount)) return undefined;
  const account = byAccount[accountKey(accountId)];
  if (!isRecord(account)) return undefined;
  const value = account[disclosureId];
  return typeof value === "boolean" ? value : undefined;
}

function disclosuresByAccount(
  document: Record<string, unknown> | null | undefined,
): DisclosureStateByAccount {
  if (!document) return {};
  const navigation = document.navigation;
  if (!isRecord(navigation)) return {};
  const value = navigation[disclosureSettingsKey];
  if (!isRecord(value)) return {};

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, account]) => {
      if (!isRecord(account)) return [];
      const disclosures = Object.fromEntries(
        Object.entries(account).filter((entry): entry is [string, boolean] => {
          const [id, open] = entry;
          return typeof open === "boolean" && (id === "apps" || isNavigatorAppId(id));
        }),
      ) as Partial<Record<NavigatorDisclosureId, boolean>>;
      return [[accountKey(key), disclosures] as const];
    }),
  );
}

/**
 * Keeps a navigator disclosure responsive during startup, then hydrates and
 * saves its state through ~/.misty/config/settings.json once native settings
 * are available.
 */
export function useNavigatorDisclosureState(
  accountId: string,
  disclosureId: NavigatorDisclosureId,
  defaultOpen: boolean,
) {
  const settings = useSettingsStore((state) => state.settings);
  const settingsLoaded = useSettingsStore((state) => state.loaded);
  const [open, setOpen] = useState(
    () => navigatorDisclosureSetting(settings?.document, accountId, disclosureId) ?? defaultOpen,
  );
  const pendingOpenRef = useRef<boolean | null>(null);

  const persist = useCallback(
    (nextOpen: boolean) => {
      const store = useSettingsStore.getState();
      if (!store.loaded) {
        pendingOpenRef.current = nextOpen;
        return;
      }

      const current = disclosuresByAccount(store.settings?.document);
      const key = accountKey(accountId);
      store.updateSetting("navigation", disclosureSettingsKey, {
        ...current,
        [key]: { ...current[key], [disclosureId]: nextOpen },
      });
    },
    [accountId, disclosureId],
  );

  useEffect(() => {
    if (!settingsLoaded) return;
    if (pendingOpenRef.current !== null) {
      const pendingOpen = pendingOpenRef.current;
      pendingOpenRef.current = null;
      persist(pendingOpen);
      return;
    }

    const saved = navigatorDisclosureSetting(settings?.document, accountId, disclosureId);
    if (saved !== undefined) setOpen(saved);
  }, [accountId, disclosureId, persist, settings?.document, settingsLoaded]);

  const onOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      persist(nextOpen);
    },
    [persist],
  );

  return [open, onOpenChange] as const;
}
