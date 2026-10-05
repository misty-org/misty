import {
  codeProjectsApi,
  githubRepoFromRemote,
  type SpaceCodeProject,
} from "@/api/spaces/code-projects";
import { agentsDeviceSnapshot, projectRemote, type AgentScope } from "@/features/agents";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { useCallback, useEffect, useState } from "react";

/** The Space's linked projects, and this computer's projects that could be linked. */
export function useSpaceCodeProjects(spaceId: string) {
  const [projects, setProjects] = useState<SpaceCodeProject[]>();
  const [local, setLocal] = useState<AgentScope[]>([]);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    codeProjectsApi
      .list(spaceId, controller.signal)
      .then((result) => setProjects(result.projects))
      .catch(() => {
        if (controller.signal.aborted) return;
        setProjects((current) => current ?? []);
        setError("This Space’s projects couldn’t load.");
      });
    return () => controller.abort();
  }, [spaceId, revision]);
  useEffect(() => {
    if (!hasTauriInternals()) return;
    void agentsDeviceSnapshot()
      .then((snapshot) =>
        setLocal(snapshot.scopes.filter((scope) => scope.kind === "project_folder")),
      )
      .catch(() => undefined);
  }, [revision]);
  const run = useCallback(async (work: () => Promise<unknown>, failure: string) => {
    setError("");
    try {
      await work();
      setRevision((value) => value + 1);
    } catch {
      setError(failure);
    }
  }, []);
  return {
    projects,
    /** Projects on this computer, for linking. */
    local,
    error,
    link: (scope: AgentScope) =>
      run(async () => {
        const remote = await projectRemote(scope.id);
        await codeProjectsApi.link(spaceId, {
          project_id: scope.id,
          device_id: scope.deviceId,
          name: scope.displayName,
          github_repo: githubRepoFromRemote(remote),
        });
      }, "That project couldn’t be linked."),
    unlink: (linkId: string) =>
      run(() => codeProjectsApi.unlink(spaceId, linkId), "That project couldn’t be unlinked."),
  };
}
