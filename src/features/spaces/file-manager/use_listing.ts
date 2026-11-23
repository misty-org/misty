import { useEffect, useState } from "react";
import { create } from "zustand";
import { disk, fileEvents, onFilesEvent, type IndexStatus } from "@/features/files";
import { messageOf } from "./format";
import { diskItem, type FileItem, type FilesPlace } from "./model";

export type SearchState =
  | { status: "loading" }
  | { status: "failed"; message: string }
  | { status: "ready"; items: FileItem[] };

const useIndexStore = create<{ status: IndexStatus }>(() => ({
  status: { state: "off", files: 0 },
}));

let followers = 0;
let stopIndex: (() => void) | null = null;

function followIndex() {
  followers += 1;
  if (followers === 1) {
    void disk.indexStatus().then(
      (status) => useIndexStore.setState({ status }),
      () => undefined,
    );
    stopIndex = onFilesEvent<IndexStatus>(fileEvents.index, (status) =>
      useIndexStore.setState({ status }),
    );
  }
  return () => {
    followers -= 1;
    if (followers === 0) {
      stopIndex?.();
      stopIndex = null;
    }
  };
}

export function useIndexStatus(on: boolean): IndexStatus {
  useEffect(() => (on ? followIndex() : undefined), [on]);
  return useIndexStore((store) => store.status);
}

const SEARCH_LIMIT = 500;
const SEARCH_WAIT_MS = 200;

export function useIndexSearch(
  place: FilesPlace,
  query: string,
  index: IndexStatus,
): SearchState | null {
  const needle = query.trim();
  const scope = place.kind === "disk" ? place.path : null;
  const usable = Boolean(needle && scope && index.state === "ready");
  const [state, setState] = useState<SearchState>({ status: "loading" });
  useEffect(() => {
    if (!usable || !scope) return;
    let live = true;
    setState({ status: "loading" });
    const timer = setTimeout(() => {
      void disk.search(needle, scope, SEARCH_LIMIT).then(
        (entries) => live && setState({ status: "ready", items: entries.map(diskItem) }),
        (cause) =>
          live &&
          messageOf(cause, "") !== "superseded" &&
          setState({ status: "failed", message: messageOf(cause, "Search couldn't run.") }),
      );
    }, SEARCH_WAIT_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [usable, needle, scope]);
  return usable ? state : null;
}
