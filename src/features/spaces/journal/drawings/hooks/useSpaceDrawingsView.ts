import { useCallback, useEffect, useRef } from "react";
import { useSpaceDrawingList } from "../api/drawingsResource";
import type { SpaceDrawing } from "../drawingTypes";

export interface DrawingsListServices {
  list(spaceId: string): Promise<{ drawings: SpaceDrawing[] }>;
  create(spaceId: string, title: string): Promise<SpaceDrawing>;
  rename(spaceId: string, drawingId: string, title: string): Promise<SpaceDrawing>;
  remove(spaceId: string, drawingId: string): Promise<unknown>;
  subscribe(spaceId: string, listener: () => void): () => void;
  changed(spaceId: string): void;
  closeDocument(spaceId: string, drawingId: string): void;
}

const noDrawings: SpaceDrawing[] = [];

/**
 * A Space's drawings. The last list paints at once on a revisit or relaunch and a fresh one
 * loads behind it; `loading` is true only on a first load with nothing saved.
 */
export function useSpaceDrawingsView(spaceId: string, services: DrawingsListServices) {
  const version = useRef({ generation: 0 }).current;
  useEffect(() => {
    version.generation++;
    return () => {
      version.generation++;
    };
  }, [spaceId, services, version]);
  const resource = useSpaceDrawingList(spaceId, (id) => services.list(id));
  const drawings = resource.data ?? noDrawings;
  const setDrawings = resource.set;
  const { reload: reloadList } = resource;
  const load = useCallback(async () => (await reloadList()) ?? [], [reloadList]);

  useEffect(() => services.subscribe(spaceId, () => void load()), [load, services, spaceId]);

  const create = useCallback(
    async (title: string) => {
      const current = version.generation;
      const drawing = await services.create(spaceId, title);
      // The list is shared with every screen showing the Space, so it changes even if this view
      // closed meanwhile.
      setDrawings((current = []) => [drawing, ...current]);
      services.changed(spaceId);
      if (current !== version.generation)
        throw new Error("This drawing view closed while creating.");
      return drawing;
    },
    [spaceId, services, setDrawings, version],
  );

  const rename = useCallback(
    async (drawingId: string, title: string) => {
      const current = version.generation;
      const drawing = await services.rename(spaceId, drawingId, title);
      setDrawings((current = []) =>
        current.map((item) => (item.id === drawingId ? drawing : item)),
      );
      services.changed(spaceId);
      if (current !== version.generation)
        throw new Error("This drawing view closed while renaming.");
      return drawing;
    },
    [spaceId, services, setDrawings, version],
  );

  const remove = useCallback(
    async (drawingId: string) => {
      const current = version.generation;
      await services.remove(spaceId, drawingId);
      // The shared list loses it even if this view closed meanwhile; only the view's own work stops.
      setDrawings((current = []) => current.filter((item) => item.id !== drawingId));
      services.changed(spaceId);
      if (current !== version.generation) return;
      services.closeDocument(spaceId, drawingId);
    },
    [spaceId, services, setDrawings, version],
  );

  return {
    drawings,
    loading: resource.loading,
    // A failed refresh keeps the list on screen; the error shows only when there is none.
    error:
      resource.error && !resource.data
        ? resource.error instanceof Error
          ? resource.error.message
          : "Could not load drawings."
        : null,
    reload: load,
    create,
    rename,
    remove,
  };
}
