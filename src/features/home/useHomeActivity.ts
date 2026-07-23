import { homeApi } from "@/api/home/api";
import { isWorkspaceToolId, useRecentToolsStore } from "@/features/workspace";
import { useCallback, useEffect, useState } from "react";
import { cacheHomeActivity, dateKey, type HomeActivity } from "./homeActivity";

type ActivityResult = { scope: string; activity: HomeActivity; state: "ready" | "error" };

/**
 * Records today's Home visit once per day across this app's windows (shared local
 * storage) and loads the visit history behind the streak and heatmap. `spaceId` scopes it to one Space; leave it out for the global Home.
 */
export function useHomeActivity(
  userId: string | undefined,
  spaceId: string | undefined,
  fallbackSpaceId: string | undefined,
) {
  const hydrateRecentTools = useRecentToolsStore((state) => state.hydrateRecentTools);
  const scope = JSON.stringify([userId, spaceId]);
  const [result, setResult] = useState<ActivityResult | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    const todayKey = dateKey(new Date());
    const sessionKey = `misty:home-activity-session:${userId ?? "guest"}:${spaceId ?? "global"}:${todayKey}`;
    let recordedThisSession = false;
    try {
      recordedThisSession = !!window.localStorage.getItem(sessionKey);
    } catch {
      // The server remains authoritative when session storage is unavailable.
    }
    let cancelled = false;
    setResult(null);
    const request = recordedThisSession
      ? homeApi.snapshot(spaceId, fallbackSpaceId)
      : homeApi.recordVisit(spaceId, todayKey, fallbackSpaceId);
    void request
      .then((snapshot) => {
        if (cancelled) return;
        setResult({ scope, activity: snapshot.activity, state: "ready" });
        cacheHomeActivity(userId ?? "", spaceId ?? "global", snapshot.activity);
        try {
          window.localStorage.setItem(sessionKey, "1");
        } catch {
          // A successful database response does not depend on local storage.
        }
        hydrateRecentTools(snapshot.recent_apps.filter(isWorkspaceToolId));
      })
      .catch(() => {
        if (!cancelled) setResult({ scope, activity: {}, state: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt, scope, fallbackSpaceId, hydrateRecentTools, spaceId, userId]);

  useEffect(() => {
    window.addEventListener("misty:refresh-focused-tool", retry);
    return () => window.removeEventListener("misty:refresh-focused-tool", retry);
  }, [retry]);

  const current = result?.scope === scope ? result : null;
  return {
    activity: current?.activity ?? {},
    state: current?.state ?? ("loading" as const),
    retry,
  };
}
