import { useEffect, useRef, useState } from "react";
import { ApiRequestError } from "@/api/client";
import { homeApi } from "@/api/home/api";
import { spacesApi } from "@/api/spaces/api";
import type { Space } from "@/api/spaces/dto/interfaces/types";
import type { SpaceAgendaEntry } from "@/api/spaces/dto/interfaces/plannerExpansionTypes";

export type HomeAgendaEntry = SpaceAgendaEntry & { spaceId: string; spaceName: string };

/** Today's earliest open entries across the account's Spaces. One request
 * reads them merged on the server; the effect depends on the Space ids, not
 * the array identity, so an equivalent Space list never reloads it. */
export function useHomeAgenda(accountId: string, spaces: Space[], loading: boolean, limit = 4) {
  const scope = JSON.stringify([accountId, spaces.map((space) => space.id)]);
  const spacesRef = useRef(spaces);
  useEffect(() => {
    spacesRef.current = spaces;
  }, [spaces]);
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
    void loadHomeAgenda(spacesRef.current, start.toISOString(), end.toISOString(), limit).then(
      (loaded) => {
        if (!cancelled) setResult({ scope, ...loaded });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [scope, loading, attempt, limit]);

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

async function loadHomeAgenda(
  spaces: Space[],
  from: string,
  to: string,
  limit: number,
): Promise<{ entries: HomeAgendaEntry[]; state: "ready" | "error" }> {
  try {
    const merged = await homeApi.agenda(from, to, limit);
    return {
      state: "ready",
      entries: merged.entries.map(({ space_id, space_name, ...entry }) => ({
        ...entry,
        spaceId: space_id,
        spaceName: space_name,
      })),
    };
  } catch (error) {
    if (!(error instanceof ApiRequestError) || error.status !== 404) {
      return { entries: [], state: "error" };
    }
  }
  // Older servers have no merged agenda; read each Space's.
  const results = await Promise.allSettled(
    spaces.map(async (space) => {
      const snapshot = await spacesApi.agenda(space.id, from, to);
      return snapshot.entries.map((entry) => ({
        ...entry,
        spaceId: space.id,
        spaceName: space.name,
      }));
    }),
  );
  const entries = results
    .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
    .filter((entry) => entry.status !== "completed")
    .sort((left, right) => Date.parse(left.starts_at) - Date.parse(right.starts_at))
    .slice(0, limit);
  return {
    entries,
    state: results.some((result) => result.status === "rejected") ? "error" : "ready",
  };
}
