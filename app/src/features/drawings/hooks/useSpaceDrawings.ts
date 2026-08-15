import { useCallback, useEffect, useState } from "react";
import { drawingsApi } from "@/api/drawings/api";
import { notifyDrawingListChanged, subscribeToDrawingListChanges } from "../drawingEvents";
import type { SpaceDrawing } from "../types";

export function useSpaceDrawings(spaceId: string) {
  const [drawings, setDrawings] = useState<SpaceDrawing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await drawingsApi.list(spaceId);
      setDrawings(result.drawings);
      return result.drawings;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load drawings.");
      return [];
    } finally {
      setLoading(false);
    }
  }, [spaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => subscribeToDrawingListChanges(spaceId, () => void load()), [load, spaceId]);

  const create = useCallback(
    async (title: string) => {
      const drawing = await drawingsApi.create(spaceId, title);
      setDrawings((current) => [drawing, ...current]);
      notifyDrawingListChanged(spaceId);
      return drawing;
    },
    [spaceId],
  );

  const rename = useCallback(
    async (drawingId: string, title: string) => {
      const drawing = await drawingsApi.rename(spaceId, drawingId, title);
      setDrawings((current) => current.map((item) => (item.id === drawingId ? drawing : item)));
      notifyDrawingListChanged(spaceId);
      return drawing;
    },
    [spaceId],
  );

  const remove = useCallback(
    async (drawingId: string) => {
      await drawingsApi.remove(spaceId, drawingId);
      setDrawings((current) => current.filter((item) => item.id !== drawingId));
      notifyDrawingListChanged(spaceId);
    },
    [spaceId],
  );

  return {
    drawings,
    loading,
    error,
    reload: load,
    create,
    rename,
    remove,
  };
}
