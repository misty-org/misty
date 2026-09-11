import {
  assertStableApiSession,
  readApiSessionGeneration,
  resolveRequiredApiBase,
} from "@/api/client";
import { appLocalStoragePrefix } from "./appLocalStorage";
import { useAppsStore } from "./useAppsStore";
import { isTrustedHostApp } from "./trustedHostApps";
import {
  integrationIds,
  type WebsiteAppId,
} from "../../../../misty-apps/apps/shared/websiteIntegrations";

/** Persist website sources in the same scoped storage used by the app directory. */
export async function addNavigatorIntegration(
  accountId: string,
  appId: string,
  providerId: string,
) {
  // Social and Inbox register sources through their provider-opening flow.
  if (!["planner", "journal", "library"].includes(appId)) return;
  if (!integrationIds(appId as WebsiteAppId).some((id) => id === providerId)) return;
  const generation = readApiSessionGeneration();
  const store = useAppsStore.getState();
  const app = store.catalog.find((candidate) => candidate.id === appId);
  if (!accountId || store.accountId !== accountId || !app || !isTrustedHostApp(app))
    throw new Error("The app is not available. Try again after it loads.");
  const serverBase = await resolveRequiredApiBase();
  assertStableApiSession(generation);
  if (
    useAppsStore.getState().accountId !== accountId ||
    useAppsStore.getState().spaceId !== store.spaceId
  )
    throw new Error("The workspace changed. Try again.");
  const prefix = appLocalStoragePrefix(serverBase, accountId, app.app_id ?? app.id, store.spaceId);
  const key = `${prefix}website-integration-v1:service:${providerId}`;
  if (!localStorage.getItem(key))
    localStorage.setItem(key, JSON.stringify({ id: providerId, order: Date.now() }));
  window.dispatchEvent(new Event("misty:provider-accounts-changed"));
}
