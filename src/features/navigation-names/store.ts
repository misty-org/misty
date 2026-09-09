import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
export interface NamesSnapshot {
  names: Record<string, string>;
  error: string | null;
}
interface NamesState extends NamesSnapshot {
  account: string;
  ready: boolean;
}
// Downloaded trusted app bundles use the same live preferences as the shell.
const shared = globalThis as typeof globalThis & {
  __mistyNavigationNames?: ReturnType<typeof createNamesStore>;
};
function createNamesStore() {
  return create<NamesState>(() => ({ account: "", ready: false, names: {}, error: null }));
}
export const useNavigationNames = (shared.__mistyNavigationNames ??= createNamesStore());
export function useNavigationName(key: string, automatic: string) {
  return useNavigationNames((s) => s.names[key] ?? automatic);
}
export function navigationName(key: string, automatic: string) {
  return useNavigationNames.getState().names[key] ?? automatic;
}
export function validateNavigationName(value: string): string {
  const name = value.trim();
  if (!name || [...name].length > 120 || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(name))
    throw new Error("Choose a single-line name of 1–120 characters.");
  return name;
}
let sequence = 0;
export async function refreshNavigationNames(account: string) {
  const run = ++sequence;
  const result = await invoke<NamesSnapshot>("navigation_names_snapshot", { account });
  if (run === sequence && useNavigationNames.getState().account === account) {
    const current = useNavigationNames.getState();
    if (
      !current.ready ||
      current.error !== result.error ||
      JSON.stringify(current.names) !== JSON.stringify(result.names)
    )
      useNavigationNames.setState({ ...result, ready: true });
  }
}
export async function setNavigationName(key: string, value: string | null) {
  const account = useNavigationNames.getState().account;
  if (!account) throw new Error("Sign in before saving navigation names.");
  const name = value === null ? null : validateNavigationName(value);
  ++sequence;
  const result = await invoke<NamesSnapshot>("navigation_names_update", { account, key, name });
  // Read after committing: overlapping windows/requests must not apply stale snapshots.
  if (useNavigationNames.getState().account === account) {
    useNavigationNames.setState({ error: result.error });
    await refreshNavigationNames(account);
  }
}
export const tabNameKey = (id: string) => `tab:${id}`;
export const groupNameKey = (id: string) => `group:${id}`;
export const sectionNameKey = (app: string) => `section:${app === "chat" ? "social" : app}`;
export const itemNameKey = (app: string, path: string[]) =>
  `item:${JSON.stringify([app === "chat" ? "social" : app, ...(path[path.length - 1]?.startsWith("pin-") ? [path[path.length - 1]!] : path)])}`;
