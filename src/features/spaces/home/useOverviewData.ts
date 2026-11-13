import { useEffect, useState } from "react";
import {
  projectApi,
  runtimeAiApi,
  useAgentAccountId,
  watchAllRunEvents,
  type GitStatus,
  type MistyActivityEntry,
} from "@/features/agents";

/** This computer's runs, kept current as they report; null until the first answer. */
export function useRuns(): MistyActivityEntry[] | null {
  const accountId = useAgentAccountId();
  const [entries, setEntries] = useState<MistyActivityEntry[] | null>(null);
  useEffect(() => {
    let live = true;
    let timer: number | undefined;
    const refresh = () =>
      // Before the agents' services are mounted there is nothing to ask yet.
      void Promise.resolve()
        .then(() => runtimeAiApi.activity(""))
        .then((result) => live && setEntries(result.entries))
        .catch(() => live && setEntries((known) => known ?? []));
    refresh();
    const stop = watchAllRunEvents(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(refresh, 500);
    });
    return () => {
      live = false;
      window.clearTimeout(timer);
      stop();
    };
  }, [accountId]);
  return entries;
}

/** Each folder's Git state, read once per folder and again when the window is returned to. */
export function useGitStatuses(folders: string[]): Record<string, GitStatus | null> {
  const [statuses, setStatuses] = useState<Record<string, GitStatus | null>>({});
  useEffect(() => {
    let live = true;
    const read = () =>
      folders.forEach((folder) =>
        projectApi
          .gitStatus(folder)
          .catch(() => null)
          .then((status) => live && setStatuses((known) => ({ ...known, [folder]: status }))),
      );
    read();
    window.addEventListener("focus", read);
    return () => {
      live = false;
      window.removeEventListener("focus", read);
    };
  }, [folders]);
  return statuses;
}
