import { create } from "zustand";
import { useSettingsProfiles } from "@/features/settings";
import { resolveSetting } from "@/features/settings";
import type { ExtensionEvent, ExtensionReview, Installation, InstalledState } from "./types";
import { extensionsNative } from "./native";

export const useExtensionsStore = create<{
  account: string;
  ready: boolean;
  supported: boolean;
  states: InstalledState[];
  error: string;
  revision: number;
  permissionRequests: ExtensionEvent[];
}>(() => ({
  account: "",
  ready: false,
  supported: false,
  states: [],
  error: "",
  revision: 0,
  permissionRequests: [],
}));

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

export function preference<T>(key: string, fallback: T): T {
  const state = useSettingsProfiles.getState().state;
  return state ? (resolveSetting(state, `extensions.${key}`).value as T) : fallback;
}
export function parseInstallations(raw: string): Installation[] {
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter(
      (item): item is Installation =>
        typeof item === "object" &&
        item !== null &&
        Number.isSafeInteger(item.id) &&
        typeof item.guid === "string" &&
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
export function installations() {
  return parseInstallations(preference("installations", "[]"));
}
export function pinIds(): number[] {
  try {
    const value: unknown = JSON.parse(preference("pins", "[]"));
    return Array.isArray(value)
      ? [
          ...new Set(
            value.filter((v): v is number => typeof v === "number" && Number.isSafeInteger(v)),
          ),
        ]
      : [];
  } catch {
    return [];
  }
}
export async function setPreference(key: string, value: string | boolean) {
  const profile = useSettingsProfiles.getState();
  if (profile.accountId !== useExtensionsStore.getState().account)
    throw new Error("The extension account changed.");
  await profile.edit(`extensions.${key}`, value);
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
export async function updateInstallation(id: number, patch: Partial<Installation>) {
  await changeControls(async () => {
    const next = installations().map((item) => (item.id === id ? { ...item, ...patch } : item));
    await setPreference("installations", JSON.stringify(next));
  });
}
export async function revokePermissions(id: number, permissions: string[], hosts: string[]) {
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
    const raw = JSON.stringify(next);
    if (raw !== preference("installations", "[]")) await setPreference("installations", raw);
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
      agentAccess: old?.agentAccess ?? true,
      permissions: [...new Set([...(old?.permissions ?? []), ...review.permissions])],
      hosts: [...new Set([...(old?.hosts ?? []), ...review.hosts])],
    };
    await setPreference(
      "installations",
      JSON.stringify([...current.filter((i) => i.id !== next.id), next]),
    );
  });
}
export async function togglePin(id: number) {
  await changeControls(async () => {
    const pins = pinIds();
    await setPreference(
      "pins",
      JSON.stringify(pins.includes(id) ? pins.filter((p) => p !== id) : [...pins, id]),
    );
  });
}
export function reportExtensionError(error: unknown) {
  useExtensionsStore.setState({ error: error instanceof Error ? error.message : String(error) });
}
