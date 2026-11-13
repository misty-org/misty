// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.
/**
 * Usage & activity pane: skill invocation statistics (Claude Code transcripts
 * only — scope is stated in the UI) and the management action log, kept as two
 * separate lists. Missing data renders as "no data", never as a fabricated
 * zero-activity list.
 */
import { useCallback } from "react";
import { refreshCachedResource, useCachedResource } from "@/api/cache/cached-resource";
import { skillsHubApi } from "./api";
import type { SkillActivityEntry, SkillUsageResult } from "./types";

/** Cache keys: both lists are this computer's own, so the last copy is kept between launches
 *  and paints at once while a fresh read runs behind it. */
const USAGE_KEY = "engine-skills/usage";
const ACTIVITY_KEY = "engine-skills/activity";

const loadUsage = () => skillsHubApi.usage(false);
const loadActivity = async () => (await skillsHubApi.activity(50)).activity ?? [];

const errorText = (error: unknown) =>
  error == null ? null : error instanceof Error ? error.message : String(error);

interface SkillUsageStore {
  usage: SkillUsageResult | null;
  /** Nothing to show yet and the first read is under way. */
  usageLoading: boolean;
  usageError: string | null;
  activity: SkillActivityEntry[];
  /** Nothing to show yet and the first read is under way. */
  activityLoading: boolean;
  activityError: string | null;
  refresh: (force?: boolean) => Promise<void>;
}

const NO_ACTIVITY: SkillActivityEntry[] = [];

export function useSkillUsage(active: boolean): SkillUsageStore {
  const usage = useCachedResource(active ? USAGE_KEY : null, loadUsage, { persist: "device" });
  const activity = useCachedResource(active ? ACTIVITY_KEY : null, loadActivity, {
    persist: "device",
  });

  // A forced read skips the native ten-minute cache; either way what is shown stays until it
  // answers, and a failure is kept beside it.
  const refresh = useCallback(async (force?: boolean) => {
    await Promise.all([
      refreshCachedResource(USAGE_KEY, () => skillsHubApi.usage(force), "device").catch(() => {}),
      refreshCachedResource(ACTIVITY_KEY, loadActivity, "device").catch(() => {}),
    ]);
  }, []);

  return {
    usage: usage.data ?? null,
    usageLoading: usage.loading,
    usageError: errorText(usage.error),
    activity: activity.data ?? NO_ACTIVITY,
    activityLoading: activity.loading,
    activityError: errorText(activity.error),
    refresh,
  };
}
