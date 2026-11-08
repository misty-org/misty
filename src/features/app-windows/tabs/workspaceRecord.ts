import { initialWorkspaceWindow } from "../profiles/windows";
import { migrateWorkspaceStore } from "./workspaceStorePersistence";

/** A window's saved record, whichever version wrote it. Throws when it can't be read. */
export function parseWorkspaceRecord(raw: string) {
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("The saved windows and tabs are not in a readable format.");
  const envelope = typeof parsed.version === "number" && parsed.state;
  const state = migrateWorkspaceStore(
    envelope ? parsed.state : parsed,
    envelope ? parsed.version : 11,
  );
  if (!state.layout) Object.assign(state, initialWorkspaceWindow());
  return state;
}
