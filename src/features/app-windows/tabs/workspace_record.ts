import { initialWorkspaceWindow } from "../profiles/windows";
import { migrateWorkspaceStore } from "./workspace_store_persistence";

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
