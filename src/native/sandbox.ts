import { invoke } from "./invoke";

/** A row in Settings: something Misty can reach once it's allowed. */
export interface SandboxPermission {
  id: string;
  label: string;
  on: boolean;
}

/** The Downloads folder's grant, which is revoked here and given by the first download's prompt. */
export const downloadsGrantId = "grant-downloads";

export function sandboxPermissionsList(): Promise<SandboxPermission[]> {
  return invoke("sandbox_permissions_list");
}

export function sandboxPermissionSet(id: string, on: boolean): Promise<void> {
  return invoke("sandbox_permission_set", { id, on });
}

/**
 * Asks where to save with the system's dialog, shown from native code, which also grants that one
 * file. A path chosen any other way can't be written. `null` when the person cancels.
 */
export function pickSaveFile(request: {
  title?: string;
  defaultName: string;
  filters: { name: string; extensions: string[] }[];
}): Promise<string | null> {
  return invoke("sandbox_pick_save_file", request);
}
