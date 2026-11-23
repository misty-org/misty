// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.
import { useCallback, useMemo, useState } from "react";
import { useCachedResource } from "@/api/cache/cached_resource";
import { skillsHubApi } from "./api";
import type {
  SkillMutationResult,
  SkillRow,
  SkillTargetId,
  SkillTargetInfo,
  SkillsInstalledResult,
} from "./types";
import { sortSkills } from "./utils";

const INSTALLED_KEY = "engine-skills/installed";

async function loadInstalled(): Promise<SkillsInstalledResult> {
  const payload = await skillsHubApi.installed();
  return { ...payload, targets: payload.targets ?? [], skills: sortSkills(payload.skills ?? []) };
}

const errorText = (error: unknown) =>
  error == null ? null : error instanceof Error ? error.message : String(error);

export interface InstalledSkillsStore {
  loading: boolean;
  error: string | null;
  targets: SkillTargetInfo[];
  skills: SkillRow[];
  pendingIds: ReadonlySet<string>;
  refresh: () => Promise<void>;
  runMutation: (
    key: string,
    operation: () => Promise<SkillMutationResult>,
  ) => Promise<SkillMutationResult>;
  setTargets: (id: string, targets: SkillTargetId[]) => Promise<SkillMutationResult>;
  uninstall: (id: string) => Promise<SkillMutationResult>;
  restore: (id: string) => Promise<SkillMutationResult>;
  deleteLocal: (directory: string, targets?: SkillTargetId[]) => Promise<SkillMutationResult>;
  importLocal: (directory: string, targets: SkillTargetId[]) => Promise<SkillMutationResult>;
}

export function useInstalledSkills(active: boolean): InstalledSkillsStore {
  const resource = useCachedResource(active ? INSTALLED_KEY : null, loadInstalled, {
    persist: "device",
  });
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  const targets = useMemo(() => resource.data?.targets ?? [], [resource.data]);
  const skills = useMemo(() => resource.data?.skills ?? [], [resource.data]);
  const { reload, set } = resource;

  const refresh = useCallback(async () => {
    await reload();
  }, [reload]);

  const rescan = useCallback(async () => {
    try {
      set(await loadInstalled());
    } catch {
      await reload();
    }
  }, [reload, set]);

  const runMutation = useCallback(
    async (key: string, operation: () => Promise<SkillMutationResult>) => {
      setPendingIds((previous) => new Set(previous).add(key));
      try {
        const result = await operation();
        await rescan();
        return result;
      } finally {
        setPendingIds((previous) => {
          const next = new Set(previous);
          next.delete(key);
          return next;
        });
      }
    },
    [rescan],
  );

  const setTargets = useCallback(
    (id: string, next: SkillTargetId[]) => runMutation(id, () => skillsHubApi.setTargets(id, next)),
    [runMutation],
  );
  const uninstall = useCallback(
    (id: string) => runMutation(id, () => skillsHubApi.uninstall(id)),
    [runMutation],
  );
  const restore = useCallback(
    (id: string) => runMutation(id, () => skillsHubApi.restore(id)),
    [runMutation],
  );
  const deleteLocal = useCallback(
    (directory: string, next?: SkillTargetId[]) =>
      runMutation(directory, () => skillsHubApi.deleteLocal(directory, next)),
    [runMutation],
  );
  const importLocal = useCallback(
    (directory: string, next: SkillTargetId[]) =>
      runMutation(directory, () => skillsHubApi.importLocal(directory, next)),
    [runMutation],
  );

  return {
    loading: resource.loading,
    error: errorText(resource.error),
    targets,
    skills,
    pendingIds,
    refresh,
    runMutation,
    setTargets,
    uninstall,
    restore,
    deleteLocal,
    importLocal,
  };
}
