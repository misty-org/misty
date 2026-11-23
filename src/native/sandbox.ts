import { invoke } from "./invoke";

export interface SandboxPermission {
  id: string;
  label: string;
  on: boolean;
}

export const downloadsGrantId = "grant-downloads";

export function sandboxPermissionsList(): Promise<SandboxPermission[]> {
  return invoke("sandbox_permissions_list");
}

export function sandboxPermissionSet(id: string, on: boolean): Promise<void> {
  return invoke("sandbox_permission_set", { id, on });
}

export function pickSaveFile(request: {
  title?: string;
  defaultName: string;
  filters: { name: string; extensions: string[] }[];
}): Promise<string | null> {
  return invoke("sandbox_pick_save_file", request);
}
