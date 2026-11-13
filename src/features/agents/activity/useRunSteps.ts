import { useEffect, useMemo, useState } from "react";
import { peekCachedResource, setCachedResource } from "@/api/cache/cached-resource";
import { watchAllRunEvents } from "../runs/local-run/localRunEvents";
import { activityApi, type RunStep } from "./activityApi";

/** Native code writes a step a moment after its event; read again after this. */
const SETTLE_MS = 350;

const changesSteps = (type: string) => type.startsWith("tool.") || type.startsWith("invocation.");

/**
 * Calls `reload` whenever one of these runs takes or ends a step, once things settle. With no runs
 * given, any run counts.
 */
export function useRunEvents(runIds: readonly string[] | null, reload: () => void) {
  const key = runIds?.join("\n") ?? "*";
  useEffect(() => {
    const watched = runIds ? new Set(runIds) : null;
    let timer = 0;
    const stop = watchAllRunEvents((runId, event) => {
      if (watched && !watched.has(runId)) return;
      if (!changesSteps(String((event as { type?: unknown }).type ?? ""))) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(reload, SETTLE_MS);
    });
    return () => {
      window.clearTimeout(timer);
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for the run ids
  }, [key, reload]);
}

/**
 * Where a run's steps are kept this session, shared by every view of them. Steps name files and
 * pages, so they stay in memory and are never written to the cache on disk.
 */
export const runStepsKey = (runId: string) => `agents/run-steps:${runId}`;

/** The steps already read for each of these runs this session, while any are known. */
function knownSteps(ids: readonly string[]): Record<string, RunStep[]> | null {
  const known: Record<string, RunStep[]> = {};
  for (const id of ids) {
    const steps = peekCachedResource<RunStep[]>(runStepsKey(id));
    if (steps) known[id] = steps;
  }
  return Object.keys(known).length ? known : null;
}

/**
 * Each of these runs' steps, oldest first, kept current while the runs go on. The steps read
 * before show at once and are read again behind them; null only until a run is first read.
 */
export function useRunSteps(runIds: readonly string[]): Record<string, RunStep[]> | null {
  const key = runIds.join("\n");
  const [steps, setSteps] = useState<Record<string, RunStep[]> | null>(() =>
    knownSteps(key ? key.split("\n") : []),
  );
  const [round, setRound] = useState(0);
  const reload = useMemo(() => () => setRound((value) => value + 1), []);
  useEffect(() => {
    let live = true;
    const ids = key ? key.split("\n") : [];
    void Promise.all(ids.map((id) => activityApi.steps(id).catch(() => undefined))).then(
      (found) => {
        if (!live) return;
        const next: Record<string, RunStep[]> = {};
        ids.forEach((id, index) => {
          const read = found[index];
          if (read) setCachedResource(runStepsKey(id), read);
          // A read that failed keeps what was shown.
          next[id] = read ?? peekCachedResource<RunStep[]>(runStepsKey(id)) ?? [];
        });
        setSteps(next);
      },
    );
    return () => {
      live = false;
    };
  }, [key, round]);
  useRunEvents(key ? key.split("\n") : [], reload);
  return steps;
}

const pictures = new Map<string, Promise<string>>();

/** A step's picture as an address an image can show, or "" while it loads or if it's gone. */
export function useStepPicture(runId: string, picture: string): string {
  const [shown, setShown] = useState("");
  useEffect(() => {
    if (!picture) {
      setShown("");
      return;
    }
    let live = true;
    const key = `${runId}/${picture}`;
    let loading = pictures.get(key);
    if (!loading) {
      loading = activityApi.picture(runId, picture).catch(() => "");
      pictures.set(key, loading);
      // Keep the cache small: the oldest pictures go first.
      if (pictures.size > 120) pictures.delete(pictures.keys().next().value!);
    }
    void loading.then((address) => live && setShown(address));
    return () => {
      live = false;
    };
  }, [runId, picture]);
  return shown;
}

/** Forgets the pictures already loaded, after the person clears their steps. */
export function forgetStepPictures() {
  pictures.clear();
}
