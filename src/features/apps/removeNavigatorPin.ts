import type { MistyNavigationItem } from "@misty/sdk";
import {
  assertStableApiSession,
  readApiSessionGeneration,
  resolveRequiredApiBase,
} from "@/api/client";
import { appLocalStoragePrefix } from "./appLocalStorage";
import { useAppsStore } from "./useAppsStore";
import { useAppNavigationStore } from "./appNavigation";
import { isTrustedHostApp } from "./trustedHostApps";
import { officialAppIdFromSlug } from "./appRoute";

/** Removing a shortcut never opens, closes, or navigates its workspace page. */
export async function removeNavigatorPin(
  accountId: string,
  appId: string,
  item: MistyNavigationItem,
) {
  const officialId = officialAppIdFromSlug(appId);
  if (!["browser", "chat", "inbox", "planner", "journal", "library"].includes(officialId))
    throw new Error("This app does not support sidebar unpinning.");
  const pinId =
    new URL(item.route, "https://misty.local").searchParams.get("pin") ??
    (item.id.startsWith("pin-") ? item.id.slice(4) : "");
  if (!accountId || !/^[a-zA-Z0-9_-]{1,160}$/.test(pinId))
    throw new Error("This pin could not be identified.");
  const generation = readApiSessionGeneration();
  const store = useAppsStore.getState();
  if (store.accountId !== accountId) throw new Error("The account changed. Try again.");
  const app = store.catalog.find((app) => app.id === officialId);
  if (!app || !isTrustedHostApp(app))
    throw new Error("The app is not available. Try again after it loads.");
  const serverBase = await resolveRequiredApiBase();
  assertStableApiSession(generation);
  if (useAppsStore.getState().accountId !== accountId)
    throw new Error("The account changed. Try again.");
  const prefix = appLocalStoragePrefix(serverBase, accountId, app.app_id ?? app.id);
  const keys =
    officialId === "browser"
      ? [`browser-page-pin-v1:${pinId}`]
      : [`provider-page-pin-v1:${pinId}`, `website-integration-v1:pin:${pinId}`];
  // Remove storage first. If access fails, keep the visible shortcut available to retry.
  for (const key of keys) localStorage.removeItem(prefix + key);
  const prune = (items: readonly MistyNavigationItem[]): MistyNavigationItem[] =>
    items.flatMap((candidate) => {
      const id = new URL(candidate.route, "https://misty.local").searchParams.get("pin");
      if (id === pinId || candidate.id === `pin-${pinId}`) return [];
      return [
        { ...candidate, ...(candidate.children ? { children: prune(candidate.children) } : {}) },
      ];
    });
  const matches = (identity: { accountId: string; appId: string }) =>
    identity.accountId === accountId && identity.appId === officialId;
  useAppNavigationStore.setState((state) => ({
    entries: state.entries.map((entry) =>
      matches(entry.identity) ? { ...entry, items: prune(entry.items) } : entry,
    ),
    providerCache: state.providerCache.map((entry) =>
      matches(entry.identity) ? { ...entry, items: prune(entry.items) } : entry,
    ),
  }));
  // Trusted downloaded apps listen on the host window and reread their own SDK storage.
  window.dispatchEvent(
    new Event(
      officialId === "browser" ? "misty:browser-pins-changed" : "misty:provider-accounts-changed",
    ),
  );
}
