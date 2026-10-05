import type { NativeSyncView } from "./native";

/** The workspace this machine shows and edits. */
export function onWorkspace(session: NativeSyncView): string | null {
  const state = session.sync;
  return state ? (state.on_workspace ?? state.driving_workspace) : null;
}
