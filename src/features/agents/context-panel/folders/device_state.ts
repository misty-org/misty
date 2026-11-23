import { invoke } from "@/native/invoke";

interface Stored<T> {
  revision: number;
  state: T | null;
}

export async function readDeviceState<T>(scope: string): Promise<T | null> {
  const stored = await invoke<Stored<T>>("settings_session_state", { scope });
  return stored.state;
}

export async function updateDeviceState<T extends object>(
  scope: string,
  seed: () => T,
  change: (state: T) => T,
): Promise<T> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const current = await invoke<Stored<T>>("settings_session_state", { scope });
    const next = change(current.state ?? seed());
    if (current.state !== null && next === current.state) return next;
    try {
      await invoke("settings_session_commit", {
        scope,
        revision: current.revision,
        document: next,
      });
      return next;
    } catch (error) {
      if (!String(error).includes("SETTINGS_REVISION_CONFLICT")) throw error;
    }
  }
  throw new Error("This changed in another window. Try again.");
}
