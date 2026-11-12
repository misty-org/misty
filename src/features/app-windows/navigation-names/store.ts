import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
interface NamesSnapshot {
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
