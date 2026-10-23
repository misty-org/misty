import type { NativeRecoveryStorage } from "@/features/browser-sync/recovery";
import type { WorkspaceLayout, WorkspaceScopeKey } from "./model";
import { spaceRecoveryKey } from "./workspaceRecoveryWriter";
import { migrateWorkspaceStore } from "./workspaceStorePersistence";

/**
 * The tabs a Space last had on this device, for a window switching to a Space it
 * hasn't shown yet. `undefined` when nothing was saved or recovery isn't open.
 */
export async function readRecoveredSpaceLayout(
  storage: NativeRecoveryStorage | undefined,
  space: { personal: boolean; key: string },
  scope: WorkspaceScopeKey,
): Promise<WorkspaceLayout | undefined> {
  if (!storage) return undefined;
  const record = spaceRecoveryKey(space);
  try {
    await storage.load(record);
    const raw = storage.getItem(record);
    if (raw === null) return undefined;
    const parsed = JSON.parse(raw);
    const envelope = typeof parsed?.version === "number" && parsed.state;
    const state = migrateWorkspaceStore(
      envelope ? parsed.state : parsed,
      envelope ? parsed.version : 11,
    );
    return state.layoutsByScope?.[scope] ?? undefined;
  } catch {
    return undefined;
  }
}
