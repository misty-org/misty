import { invoke } from "@/native/invoke";
export interface StoredState<T> {
  revision: number;
  state: T | null;
}
export async function readState<T>(scope: string): Promise<StoredState<T>> {
  return invoke("settings_profile_state", { scope });
}
async function commitState<T>(scope: string, revision: number, state: T): Promise<void> {
  await invoke("settings_profile_commit", { scope, revision, document: state });
}
export async function mutateState<T>(
  scope: string,
  seed: () => T,
  reducer: (state: T) => T,
): Promise<T> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const current = await readState<T>(scope);
    const next = reducer(current.state ?? seed());
    if (current.state !== null && next === current.state) return next;
    try {
      await commitState(scope, current.revision, next);
      return next;
    } catch (error) {
      if (!String(error).includes("SETTINGS_REVISION_CONFLICT")) throw error;
    }
  }
  throw new Error("Settings changed in another window. Try again.");
}
