import { useEffect, useMemo, useState } from "react";
import { create } from "zustand";
import type { MistyActivityEntry } from "../conversations/state/activity";
import { spacesGateway } from "../spaces-gateway/spacesGateway";
import { questsOf, startOfToday, useStudioQuests, type Quest } from "./studioQuests";
import {
  pointsOf,
  progressOf,
  recordsOf,
  useStudioLedger,
  type AgentRecord,
  type Progress,
  type StudioTally,
} from "./studioProgress";

/** How often the Space's own counts are read again while the studio is open. */
const RECOUNT_MS = 5 * 60_000;

export interface SpaceGame {
  id: string;
  name: string;
  addedAt: string;
}

interface GamesState {
  bySpace: Record<string, SpaceGame[]>;
  loading: Record<string, boolean>;
  load(spaceId: string): Promise<void>;
}

/** The Space's games for the arcade cabinet, read once a while and shared by everything in the
 * studio that shows them. */
export const useSpaceGames = create<GamesState>((set, get) => ({
  bySpace: {},
  loading: {},
  async load(spaceId) {
    const gateway = spacesGateway.maybe();
    if (!spaceId || !gateway || get().loading[spaceId]) return;
    set({ loading: { ...get().loading, [spaceId]: true } });
    try {
      const games = await gateway.spaceGames(spaceId);
      set({ bySpace: { ...get().bySpace, [spaceId]: games } });
    } catch {
      // The cabinet just shows nothing new; the next look tries again.
    } finally {
      set({ loading: { ...get().loading, [spaceId]: false } });
    }
  },
}));

/** The Space's notes and other members, counted for its milestones, and whether they (and its
 * games) have been read at least once. */
function useSpaceCounts(spaceId: string): { notes: number; members: number; ready: boolean } {
  const [counts, setCounts] = useState({ notes: 0, members: 0, ready: false });
  useEffect(() => {
    const gateway = spacesGateway.maybe();
    if (!spaceId || !gateway) return;
    let active = true;
    const read = () => {
      void Promise.all([
        gateway.noteCount(spaceId).catch(() => null),
        gateway.otherMembers(spaceId).catch(() => null),
        useSpaceGames.getState().load(spaceId),
      ]).then(([notes, members]) => {
        if (!active) return;
        setCounts((known) => ({
          notes: notes ?? known.notes,
          members: members ? members.length : known.members,
          ready: true,
        }));
      });
    };
    read();
    const timer = window.setInterval(read, RECOUNT_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [spaceId]);
  return counts;
}

/**
 * The studio's points and unlocks, and each agent's record, from the runs seen to finish on this
 * computer and what the Space itself has.
 */
export function useStudioProgress(props: {
  account: string;
  spaceId: string;
  agentIds: readonly string[];
  entries: readonly MistyActivityEntry[];
}): {
  progress: Progress;
  tally: StudioTally;
  records: Map<string, AgentRecord>;
  /** Today's quests and how far each has got. */
  quests: Quest[];
  /** The Space's own counts have been read, so the points are not still climbing to where
   * they already were. */
  ready: boolean;
} {
  const { account, spaceId, agentIds, entries } = props;
  useEffect(() => {
    if (account) useStudioLedger.getState().note(account, entries);
  }, [account, entries]);
  const runs = useStudioLedger((state) => (state.account === account ? state.runs : null));
  const records = useMemo(() => recordsOf(runs ?? {}), [runs]);
  const counts = useSpaceCounts(spaceId);
  const games = useSpaceGames((state) => state.bySpace[spaceId]?.length ?? 0);
  const day = useStudioQuests((state) => state.day);
  const questsDone = useStudioQuests((state) => state.done.length);
  const quests = useMemo(() => {
    const since = startOfToday();
    const own = new Set(agentIds);
    const tasksToday = Object.values(runs ?? {}).filter(
      (ran) => ran.ok && ran.at >= since && own.has(ran.agent),
    ).length;
    return questsOf(tasksToday, day);
  }, [runs, agentIds, day]);
  useEffect(() => {
    // A quest done today is counted once, for its points.
    for (const quest of quests)
      if (quest.have >= quest.need) useStudioQuests.getState().finish(quest.id);
  }, [quests]);
  const tally = useMemo<StudioTally>(() => {
    const tasks = agentIds.reduce((sum, id) => sum + (records.get(id)?.done ?? 0), 0);
    return {
      tasks,
      agents: agentIds.length,
      members: counts.members,
      notes: counts.notes,
      games,
      quests: questsDone,
    };
  }, [agentIds, records, counts, games, questsDone]);
  const progress = useMemo(() => progressOf(pointsOf(tally)), [tally]);
  return { progress, tally, records, quests, ready: counts.ready && runs !== null };
}
