import { useEffect, useState } from "react";
import { spacesApi } from "@/api/spaces/api";
import type { Space } from "@/api/spaces/dto/interfaces/types";
import type { SpaceAgendaEntry } from "@/api/spaces/dto/interfaces/plannerExpansionTypes";

export type HomeAgendaEntry = SpaceAgendaEntry & { spaceId: string; spaceName: string };

export function useHomeAgenda(accountId: string, spaces: Space[], loading: boolean) {
  const scope = JSON.stringify([accountId, spaces.map((space) => space.id)]);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    scope: string;
    entries: HomeAgendaEntry[];
    state: "ready" | "error";
  } | null>(null);

  useEffect(() => {
    if (loading) return;
    let cancelled = false;
    setResult(null);
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    void Promise.allSettled(
      spaces.map(async (space) => {
        const snapshot = await spacesApi.agenda(space.id, start.toISOString(), end.toISOString());
        return snapshot.entries.map((entry) => ({
          ...entry,
          spaceId: space.id,
          spaceName: space.name,
        }));
      }),
    ).then((results) => {
      if (cancelled) return;
      const entries = results
        .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
        .filter((entry) => entry.status !== "completed")
        .sort((left, right) => Date.parse(left.starts_at) - Date.parse(right.starts_at))
        .slice(0, 4);
      setResult({
        scope,
        entries,
        state: results.some((result) => result.status === "rejected") ? "error" : "ready",
      });
    });
    return () => {
      cancelled = true;
    };
  }, [scope, spaces, loading, attempt]);

  useEffect(() => {
    const refresh = () => setAttempt((value) => value + 1);
    window.addEventListener("misty:refresh-focused-tool", refresh);
    return () => window.removeEventListener("misty:refresh-focused-tool", refresh);
  }, []);

  return {
    entries: result?.scope === scope ? result.entries : [],
    state: loading || result?.scope !== scope ? ("loading" as const) : result.state,
    retry: () => setAttempt((value) => value + 1),
  };
}
