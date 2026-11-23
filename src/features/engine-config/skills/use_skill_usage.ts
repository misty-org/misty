// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.
import { useCallback } from "react";
import { refreshCachedResource, useCachedResource } from "@/api/cache/cached_resource";
import { skillsHubApi } from "./api";
import type { SkillActivityEntry, SkillUsageResult } from "./types";

const USAGE_KEY = "engine-skills/usage";
const ACTIVITY_KEY = "engine-skills/activity";

const loadUsage = () => skillsHubApi.usage(false);
const loadActivity = async () => (await skillsHubApi.activity(50)).activity ?? [];

const errorText = (error: unknown) =>
  error == null ? null : error instanceof Error ? error.message : String(error);

interface SkillUsageStore {
  usage: SkillUsageResult | null;
  usageLoading: boolean;
  usageError: string | null;
  activity: SkillActivityEntry[];
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
