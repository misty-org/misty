import { create } from "zustand";
import { useDevicePreferences } from "@/features/settings";
import { resolveSetting } from "@/features/settings";
import { spaceWindow } from "@/features/workspace/spaceWindow";
import type {
  ExtensionEvent,
  ExtensionReview,
  ExtensionStore,
  Installation,
  InstalledState,
} from "./types";
import { extensionsNative } from "./native";

export const useExtensionsStore = create<{
  account: string;
  ready: boolean;
  supported: boolean;
  states: InstalledState[];
  error: string;
  revision: number;
  permissionRequests: ExtensionEvent[];
  /** "Add to Misty" on a store page: the extension ID or Firefox slug to review. */
  installRequest: string | null;
  /** "Remove from Misty" on a store page: the installed extension to confirm removing. */
  removeRequest: string | null;
}>(() => ({
  account: "",
  ready: false,
  supported: false,
  states: [],
  error: "",
  revision: 0,
  permissionRequests: [],
  installRequest: null,
  removeRequest: null,
}));

/** Opens the install review for an extension ID or Firefox Add-ons slug. */
export function requestInstall(key: string) {
  useExtensionsStore.setState({ installRequest: key });
}
export function enqueuePermission(request: ExtensionEvent) {
  useExtensionsStore.setState((state) =>
    request.account !== state.account ||
    !request.requestId ||
    state.permissionRequests.some((pending) => pending.requestId === request.requestId)
      ? state
      : { permissionRequests: [...state.permissionRequests, request] },
  );
}
export function finishPermission(requestId: string) {
  useExtensionsStore.setState((state) => ({
    permissionRequests: state.permissionRequests.filter(
      (request) => request.requestId !== requestId,
    ),
  }));
}

function preference<T>(key: string, fallback: T): T {
  const state = useDevicePreferences.getState().state;
  return state ? (resolveSetting(state, `extensions.${key}`).value as T) : fallback;
}
const chromeId = /^[a-p]{32}$/;
const firefoxId = /^[1-9][0-9]{0,15}$/;
/** Firefox Add-ons IDs are digits; Chrome Web Store IDs are 32 letters a–p. */
export function extensionStore(id: string): ExtensionStore | null {
  return chromeId.test(id) ? "chrome" : firefoxId.test(id) ? "firefox" : null;
}
export const storeNames: Record<ExtensionStore, string> = {
  chrome: "Chrome Web Store",
  firefox: "Firefox Add-ons",
};
/**
 * The stores people can add extensions from. Misty's one extension standard is
 * Chrome (Manifest V3), so Firefox Add-ons is not offered; extensions already
 * installed from it keep their own identity and stay manageable.
 */
export const offeredStores: ExtensionStore[] = ["chrome"];
export const storeHomes: Record<ExtensionStore, string> = {
  chrome: "https://chromewebstore.google.com/",
  firefox: "https://addons.mozilla.org/firefox/",
};
/** An extension's page on its store. */
export function storePage(item: Pick<Installation, "id" | "guid">): string {
  return extensionStore(item.id) === "chrome"
    ? `https://chromewebstore.google.com/detail/${item.id}`
    : `https://addons.mozilla.org/firefox/addon/${encodeURIComponent(item.guid)}/`;
}
/** Older versions of Misty read Firefox IDs as numbers, so they are stored that way. */
function storedInstallations(items: Installation[]): string {
  return JSON.stringify(
    items.map((item) =>
      extensionStore(item.id) === "firefox" ? { ...item, id: Number(item.id) } : item,
    ),
  );
}
/** Settings written before Chrome Web Store support hold Firefox IDs as numbers. */
function withTextId(item: unknown): unknown {
  if (typeof item !== "object" || item === null) return item;
  const id = (item as { id?: unknown }).id;
  return typeof id === "number" && Number.isSafeInteger(id) && id > 0
    ? { ...item, id: String(id) }
    : item;
}
export function parseInstallations(raw: string): Installation[] {
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    const items: typeof value = value.map(withTextId);
    return items.filter(
      (item): item is Installation =>
        typeof item === "object" &&
        item !== null &&
        typeof item.id === "string" &&
        extensionStore(item.id) !== null &&
        typeof item.guid === "string" &&
        // A Chrome extension's identity is its ID; Firefox identities never look like one.
        (extensionStore(item.id) === "chrome"
          ? item.guid === item.id
          : !chromeId.test(item.guid)) &&
        typeof item.generation === "string" &&
        typeof item.name === "string" &&
        typeof item.installed === "boolean" &&
        typeof item.enabled === "boolean" &&
        typeof item.privateAccess === "boolean" &&
        typeof item.agentAccess === "boolean" &&
        Array.isArray(item.permissions) &&
        item.permissions.every((p: unknown) => typeof p === "string") &&
        Array.isArray(item.hosts) &&
        item.hosts.every((p: unknown) => typeof p === "string"),
    );
  } catch {
    return [];
  }
}
type SettingsState = NonNullable<ReturnType<typeof useDevicePreferences.getState>["state"]>;
/** Every other Space's installations: `[{ space, installations }]`. */
type SpaceList = { space: string; installations: unknown };
function spaceLists(raw: unknown): SpaceList[] {
  try {
    const value: unknown = JSON.parse(String(raw));
    return Array.isArray(value)
      ? value.filter(
          (entry): entry is SpaceList =>
            typeof entry === "object" && entry !== null && typeof entry.space === "string",
        )
      : [];
  } catch {
    return [];
  }
}
/**
 * Extensions are installed per Space, as each Space runs its own extension host.
 * The personal Space keeps the list from before Spaces; every other Space has its
 * own entry. This window's Space is the one its toolbar and Settings manage.
 */
export function spaceInstallationsRaw(state: SettingsState | null | undefined): string {
  if (!state) return "[]";
  const space = spaceWindow();
  if (space.personal) return String(resolveSetting(state, "extensions.installations").value);
  const list = spaceLists(resolveSetting(state, "extensions.space_installations").value).find(
    (entry) => entry.space === space.key,
  )?.installations;
  return Array.isArray(list) ? JSON.stringify(list) : "[]";
}
function installationsRaw(): string {
  return spaceInstallationsRaw(useDevicePreferences.getState().state);
}
export function installations() {
  return parseInstallations(installationsRaw());
}
async function setInstallations(raw: string) {
  const space = spaceWindow();
  if (space.personal) {
    await setPreference("installations", raw);
    return;
  }
  const lists = spaceLists(preference("space_installations", "[]")).filter(
    (entry) => entry.space !== space.key,
  );
  await setPreference(
    "space_installations",
    JSON.stringify([...lists, { space: space.key, installations: JSON.parse(raw) as unknown }]),
  );
}
export async function setPreference(key: string, value: string | boolean) {
  await useDevicePreferences.getState().edit(`extensions.${key}`, value);
}
let controlQueue: Promise<unknown> = Promise.resolve();
function changeControls(work: () => Promise<void>) {
  const account = useExtensionsStore.getState().account;
  const next = controlQueue
    .catch(() => {})
    .then(async () => {
      if (account !== useExtensionsStore.getState().account)
        throw new Error("The extension account changed.");
      await work();
    });
  controlQueue = next;
  return next;
}
export async function updateInstallation(id: string, patch: Partial<Installation>) {
  await changeControls(async () => {
    const next = installations().map((item) => (item.id === id ? { ...item, ...patch } : item));
    await setInstallations(storedInstallations(next));
  });
}
export async function revokePermissions(id: string, permissions: string[], hosts: string[]) {
  await changeControls(async () => {
    const next = installations().map((item) =>
      item.id === id
        ? {
            ...item,
            permissions: item.permissions.filter((value) => !permissions.includes(value)),
            hosts: item.hosts.filter((value) => !hosts.includes(value)),
          }
        : item,
    );
    const raw = storedInstallations(next);
    if (raw !== installationsRaw()) await setInstallations(raw);
  });
}
export async function install(review: ExtensionReview, privateAccess: boolean) {
  if (review.blocked)
    throw new Error("This extension requires browser APIs that are unavailable in Misty.");
  const account = useExtensionsStore.getState().account;
  const existing = installations().find((item) => item.id === review.entry.id && item.installed);
  const generation = existing?.generation ?? crypto.randomUUID();
  await extensionsNative.commit(review.token, existing ? null : generation);
  if (account !== useExtensionsStore.getState().account)
    throw new Error("The account changed during installation.");
  await changeControls(async () => {
    const current = installations();
    const old = current.find((i) => i.id === review.entry.id && i.installed);
    const next: Installation = {
      id: review.entry.id,
      guid: review.entry.guid,
      name: review.entry.name,
      generation: old?.generation ?? generation,
      installed: true,
      enabled: old?.enabled ?? true,
      privateAccess: review.privateAllowed && privateAccess,
      // A new extension is off limits to agents until the person allows it.
      agentAccess: old?.agentAccess ?? false,
      permissions: [...new Set([...(old?.permissions ?? []), ...review.permissions])],
      hosts: [...new Set([...(old?.hosts ?? []), ...review.hosts])],
    };
    await setInstallations(storedInstallations([...current.filter((i) => i.id !== next.id), next]));
  });
}
export function reportExtensionError(error: unknown) {
  useExtensionsStore.setState({ error: error instanceof Error ? error.message : String(error) });
}
