import { useEffect, useMemo, useState } from "react";
import { peekCachedResource, setCachedResource } from "@/api/cache/cached_resource";
import { watchAllRunEvents } from "../runs/local-run/local_run_events";
import { activityApi, type RunStep } from "./activity_api";

const SETTLE_MS = 350;

const changesSteps = (type: string) => type.startsWith("tool.") || type.startsWith("invocation.");

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

export const runStepsKey = (runId: string) => `agents/run-steps:${runId}`;

function knownSteps(ids: readonly string[]): Record<string, RunStep[]> | null {
  const known: Record<string, RunStep[]> = {};
  for (const id of ids) {
    const steps = peekCachedResource<RunStep[]>(runStepsKey(id));
    if (steps) known[id] = steps;
  }
  return Object.keys(known).length ? known : null;
}

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
      if (pictures.size > 120) pictures.delete(pictures.keys().next().value!);
    }
    void loading.then((address) => live && setShown(address));
    return () => {
      live = false;
    };
  }, [runId, picture]);
  return shown;
}

export function forgetStepPictures() {
  pictures.clear();
}
