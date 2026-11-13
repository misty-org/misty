// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.
/**
 * Installed-skills data source: list + targets + per-entry mutations.
 *
 * The list is a disk scan of every engine's skills folder, kept in the shared cache (and on this
 * computer between launches): reopening the pane paints the last list at once and scans again
 * behind it. Only the very first scan, with nothing saved, shows a skeleton. Mutations disable
 * only their own row (`pendingIds`), leaving other rows operable.
 */
import { useCallback, useMemo, useState } from "react";
import { useCachedResource } from "@/api/cache/cached-resource";
import { skillsHubApi } from "./api";
import type {
  SkillMutationResult,
  SkillRow,
  SkillTargetId,
  SkillTargetInfo,
  SkillsInstalledResult,
} from "./types";
import { sortSkills } from "./utils";

/** The cache key of the installed list: one per computer, shared by every pane showing it. */
const INSTALLED_KEY = "engine-skills/installed";

/** Reads the installed list, sorted once here so every reader shows the same order. */
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
  // Lazy page: only the visible Installed pane loads; other panes never scan.
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

  /** Scans again after a change, never joining a scan that began before the change landed. */
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
        // Re-read instead of trusting the mutation payload: the disk is the
        // source of truth for target states after a partial failure.
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
