import { useEffect, useMemo, useState } from "react";
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

/** Each of these runs' steps, oldest first, kept current while the runs go on. Null until read. */
export function useRunSteps(runIds: readonly string[]): Record<string, RunStep[]> | null {
  const [steps, setSteps] = useState<Record<string, RunStep[]> | null>(null);
  const [round, setRound] = useState(0);
  const key = runIds.join("\n");
  const reload = useMemo(() => () => setRound((value) => value + 1), []);
  useEffect(() => {
    let live = true;
    const ids = key ? key.split("\n") : [];
    void Promise.all(ids.map((id) => activityApi.steps(id).catch(() => [] as RunStep[]))).then(
      (found) => {
        if (!live) return;
        setSteps(Object.fromEntries(ids.map((id, index) => [id, found[index] ?? []])));
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
