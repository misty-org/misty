import type { NativeSyncView } from "./native";
export function syncSession(overrides: Partial<NativeSyncView> = {}): NativeSyncView {
  return {
    session_id: "s",
    account_id: "a",
    deployment: "https://example.test",
    vault_id: "w",
    device_id: "d",
    profile_id: "p",
    browser_profile_ready: true,
    status: {
      phase: "ready",
      applied_sequence: 1,
      head_sequence: 1,
      pending_changes: 0,
      issue: null,
    },
    devices: [
      {
        device_id: "d",
        display_name: "MacBook",
        platform: "macos",
        control_version: 1,
        full_sync: true,
      },
      {
        device_id: "other",
        display_name: "Office",
        platform: "windows",
        control_version: 1,
        full_sync: true,
      },
    ],
    presence: [{ device_id: "other", online: true, ready: true, applied_sequence: 1 }],
    pending_operation_ids: [],
    workspace: {
      version: 1,
      sequence: 1,
      active_device: { device_id: "d", epoch: "e", sequence: 1 },
      records: [],
      resumes: {},
      orphaned_view_ids: [],
      orphaned_bookmark_ids: [],
    },
    sync: {
      device_id: "d",
      shared_workspace_id: "shared",
      driving_workspace: "d",
      workspaces: [
        {
          workspace_id: "d",
          shared: false,
          driver_device_id: "d",
          driver_epoch: "e",
          driver_seen_at: 1,
          version: 1,
        },
      ],
      contents: {},
      pending: [],
      displaced_with_edits: false,
    },
    ...overrides,
  };
}
