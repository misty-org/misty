import { useEffect, useState } from "react";
import { create } from "zustand";
import { disk, type FinderTag, type FreeSpace, type Places } from "@/features/files";

interface PlacesStore {
  places: Places | null;
  tags: FinderTag[];
  starred: ReadonlySet<string>;
}

export const usePlacesStore = create<PlacesStore>(() => ({
  places: null,
  tags: [],
  starred: new Set(),
}));

let loaded = false;

export function refreshPlaces() {
  if (!loaded) return;
  void disk.tags().then(
    (tags) => usePlacesStore.setState({ tags }),
    () => undefined,
  );
  void disk.starred().then(
    (entries) => usePlacesStore.setState({ starred: new Set(entries.map((entry) => entry.path)) }),
    () => undefined,
  );
}

export function useLoadPlaces(granted: boolean) {
  useEffect(() => {
    if (!granted) return;
    loaded = true;
    void disk.places().then(
      (places) => usePlacesStore.setState({ places }),
      () => undefined,
    );
    refreshPlaces();
  }, [granted]);
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
