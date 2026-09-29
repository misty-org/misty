const messages: Record<string, string> = {
  sign_in_required: "Sign in again to reconnect sync.",
  sync_device_forbidden:
    "This device does not have permission to sync this workspace. Check its sync access, then retry.",
  vault_identity_failed:
    "Could not verify this device’s sync identity. Local data has been preserved.",
  replay_conflict: "Sync ordering could not be verified. Local data has been preserved.",
  checkpoint_or_key_recovery_required:
    "Sync needs a recovery step. Open Sync settings to reconnect. Local data has been preserved.",
  local_storage_unavailable:
    "Local sync storage is unavailable. Check available disk space, then retry.",
  sync_protocol_failed: "Sync could not complete. Try reconnecting.",
};

/** Worker status uses stable codes; command failures already contain safe UI text. */
export function syncIssueMessage(issue: string | null | undefined): string | null {
  return issue ? (messages[issue] ?? issue) : null;
}
