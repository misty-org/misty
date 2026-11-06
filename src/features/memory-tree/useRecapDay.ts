import { useEffect, useState } from "react";
import { localDay, memoryApi, type MemoryEvent } from "@/features/recall";
import { treeApi } from "./api";
import { dayBounds } from "./recapDay";
import type { MemoryNode } from "./model";

interface RecapDay {
  day: string;
  recap?: Pick<MemoryNode, "text" | "outline">;
  /** The day's moments, newest first. */
  events: MemoryEvent[];
  previous?: string;
  following?: string;
}

/** The day after this one that has moments. Events come newest first, so it's the oldest listed. */
async function followingDay(spaceId: string, to: string) {
  const { events } = await memoryApi.events({ space_id: spaceId, from: to, limit: 200 });
  const oldest = events[events.length - 1];
  return oldest && localDay(oldest.occurred_at);
}

async function readDay(spaceId: string, day: string): Promise<RecapDay> {
  const { from, to } = dayBounds(day);
  const [summaries, { events }, before, following] = await Promise.all([
    treeApi.children(spaceId, "summaries", "all"),
    memoryApi.events({ space_id: spaceId, from, to, limit: 100 }),
    memoryApi.events({ space_id: spaceId, to: from, limit: 1 }),
    followingDay(spaceId, to),
  ]);
  return {
    day,
    events,
    recap: summaries.find((node) => node.id === `summary:recap-${day}`),
    previous: before.events[0] && localDay(before.events[0].occurred_at),
    following,
  };
}

/**
 * One day of the recap: its text, its moments and the days on either side. It opens on `start`,
 * or the latest day with moments.
 */
export function useRecapDay(spaceId: string, start: string | null) {
  const [recap, setRecap] = useState<RecapDay | null | undefined>(undefined);
  const [day, setDay] = useState(start);

  useEffect(() => {
    if (start) setDay(start);
  }, [start]);

  useEffect(() => {
    let current = true;
    (async () => {
      const shown =
        day ?? (await memoryApi.events({ space_id: spaceId, limit: 1 })).events[0]?.occurred_at;
      return shown ? readDay(spaceId, day ?? localDay(shown)) : null;
    })().then(
      (loaded) => current && setRecap(loaded),
      () => current && setRecap(null),
    );
    return () => {
      current = false;
    };
  }, [spaceId, day]);

  return { recap, showDay: setDay };
}
