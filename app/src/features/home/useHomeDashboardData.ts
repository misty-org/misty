import { useSpacesStore } from "@/features/spaces";
import { spacesApi } from "@/services/spaces/api";
import type { SpaceAgendaEntry } from "@/services/spaces/dto/interfaces/plannerExpansionTypes";
import type { Space } from "@/services/spaces/dto/interfaces/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";

export interface HomeAgendaItem extends SpaceAgendaEntry {
  spaceId: string;
  spaceName: string;
}

export function useHomeDashboardData(accountId: string) {
  const generationRef = useRef(0);
  const [agenda, setAgenda] = useState<HomeAgendaItem[]>([]);
  const [agendaLoading, setAgendaLoading] = useState(false);
  const [agendaFailures, setAgendaFailures] = useState(0);
  const { spaces, invitations, snapshotReady, loading, error, load, loadInbox } = useSpacesStore(
    useShallow((state) => ({
      spaces: state.spaces,
      invitations: state.invitations,
      snapshotReady: state.snapshotReady,
      loading: state.loading,
      error: state.error,
      load: state.load,
      loadInbox: state.loadInbox,
    })),
  );

  useEffect(() => {
    if (!accountId) return;
    void load({ accountId });
    void loadInbox().catch(() => undefined);
  }, [accountId, load, loadInbox]);

  const refreshAgenda = useCallback(async () => {
    const generation = ++generationRef.current;
    const readableSpaces = spaces.filter((space) => space.permissions?.["tasks.view"] !== false);
    if (!readableSpaces.length) {
      setAgenda([]);
      setAgendaFailures(0);
      return;
    }
    setAgendaLoading(true);
    const { from, to } = todayRange();
    const results = await Promise.allSettled(
      readableSpaces.map(async (space) => ({
        space,
        snapshot: await spacesApi.agenda(space.id, from, to),
      })),
    );
    if (generation !== generationRef.current) return;
    const next = results.flatMap((result) =>
      result.status === "fulfilled"
        ? result.value.snapshot.entries.map((entry) => ({
            ...entry,
            spaceId: result.value.space.id,
            spaceName: result.value.space.name,
          }))
        : [],
    );
    setAgenda(next.sort(compareAgenda).slice(0, 8));
    setAgendaFailures(results.filter((result) => result.status === "rejected").length);
    setAgendaLoading(false);
  }, [spaces]);

  useEffect(() => {
    if (!snapshotReady) return;
    void refreshAgenda();
    return () => {
      generationRef.current += 1;
    };
  }, [refreshAgenda, snapshotReady]);

  return {
    spaces: sortSpaces(spaces),
    invitations,
    agenda,
    agendaLoading,
    agendaFailures,
    snapshotReady,
    loading,
    error,
    refresh: () => Promise.allSettled([load({ accountId, force: true }), loadInbox()]),
    refreshAgenda,
  };
}

function todayRange() {
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + 1);
  return { from: from.toISOString(), to: to.toISOString() };
}

function compareAgenda(left: HomeAgendaItem, right: HomeAgendaItem): number {
  if (left.all_day !== right.all_day) return left.all_day ? -1 : 1;
  return (
    Date.parse(left.starts_at) - Date.parse(right.starts_at) ||
    left.title.localeCompare(right.title)
  );
}

function sortSpaces(spaces: Space[]): Space[] {
  return [...spaces].sort(
    (left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at),
  );
}
