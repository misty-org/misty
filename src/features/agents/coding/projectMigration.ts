import { invoke } from "@tauri-apps/api/core";
import { ApiRequestError, apiRequest } from "@/api/client";

interface LegacyProjectFlags {
  scopeId: string;
  allowInstalls: boolean;
  allowPush: boolean;
}

/** The remembered approvals a project's old switches stand for. */
export function legacyActions(flags: LegacyProjectFlags, repo: string | null) {
  const actions = ["project.edit"];
  if (flags.allowInstalls) actions.push("project.install");
  if (flags.allowPush && repo) actions.push("git.push");
  return actions;
}

/**
 * Carries projects' old switches ("allow changes", "allow installs", "allow
 * pushes") over to the server once, as remembered approvals for the person's
 * Misty agent. A project not yet attached to any chat waits for a later launch.
 */
export async function migrateProjectSwitches() {
  const pending = await invoke<[LegacyProjectFlags, string | null][]>("project_legacy_flags");
  for (const [flags, repo] of pending) {
    try {
      await apiRequest("/me/agent-grants/project", {
        method: "POST",
        body: JSON.stringify({
          scope_id: flags.scopeId,
          actions: legacyActions(flags, repo),
          repo: repo ?? "",
        }),
      });
      await invoke("project_legacy_flags_done", { scopeId: flags.scopeId });
    } catch (error) {
      if (!(error instanceof ApiRequestError && error.status === 409)) throw error;
    }
  }
}
