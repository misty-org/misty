import { useCallback, useEffect, useState } from "react";
import {
  disk,
  type AgentTrashUsage,
  type FinderTag,
  type FreeSpace,
  type Places,
} from "@/features/files";

export function useFilesPlaces(granted: boolean) {
  const [places, setPlaces] = useState<Places | null>(null);
  const [tags, setTags] = useState<FinderTag[]>([]);
  const [agentTrash, setAgentTrash] = useState<AgentTrashUsage | null>(null);
  const [starred, setStarred] = useState<ReadonlySet<string>>(new Set());

  const refresh = useCallback(() => {
    if (!granted) return;
    void disk.tags().then(setTags, () => undefined);
    void disk.agentTrashUsage().then(setAgentTrash, () => undefined);
    void disk.starred().then(
      (entries) => setStarred(new Set(entries.map((entry) => entry.path))),
      () => undefined,
    );
  }, [granted]);

  useEffect(() => {
    if (!granted) return;
    let live = true;
    void disk.places().then(
      (next) => live && setPlaces(next),
      () => undefined,
    );
    refresh();
    return () => {
      live = false;
    };
  }, [granted, refresh]);

  return { places, tags, agentTrash, starred, refresh };
}

export function useFreeSpace(folder: string | undefined, granted: boolean, revision: number) {
  const [free, setFree] = useState<FreeSpace | null>(null);
  useEffect(() => {
    if (!folder || !granted) return setFree(null);
    let live = true;
    void disk.freeSpace(folder).then(
      (next) => live && setFree(next),
      () => live && setFree(null),
    );
    return () => {
      live = false;
    };
  }, [folder, granted, revision]);
  return free;
}
