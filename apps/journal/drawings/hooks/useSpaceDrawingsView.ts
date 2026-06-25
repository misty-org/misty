import { useCallback, useEffect, useRef, useState } from "react";
import type { SpaceDrawing } from "../types";

export interface DrawingsListServices {
  list(spaceId: string): Promise<{ drawings: SpaceDrawing[] }>;
  create(spaceId: string, title: string): Promise<SpaceDrawing>;
  rename(spaceId: string, drawingId: string, title: string): Promise<SpaceDrawing>;
  remove(spaceId: string, drawingId: string): Promise<unknown>;
  subscribe(spaceId: string, listener: () => void): () => void;
  changed(spaceId: string): void;
  closeDocument(spaceId: string, drawingId: string): void;
}

export function useSpaceDrawingsView(spaceId: string, services: DrawingsListServices) {
  const version = useRef({ generation: 0, requests: 0 }).current;
  useEffect(() => {
    version.generation++;
    setDrawings([]);
    return () => {
      version.generation++;
      version.requests++;
    };
  }, [spaceId, services, version]);
  const [drawings, setDrawings] = useState<SpaceDrawing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const request = ++version.requests;
    const current = version.generation;
    const active = () => current === version.generation && request === version.requests;
    setLoading(true);
    setError(null);
    try {
      const result = await services.list(spaceId);
      if (active()) setDrawings(result.drawings);
      return result.drawings;
    } catch (cause) {
      if (active()) setError(cause instanceof Error ? cause.message : "Could not load drawings.");
      return [];
    } finally {
      if (active()) setLoading(false);
    }
  }, [spaceId, services, version]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => services.subscribe(spaceId, () => void load()), [load, services, spaceId]);

  const create = useCallback(
    async (title: string) => {
      const current = version.generation;
      const drawing = await services.create(spaceId, title);
      if (current !== version.generation)
        throw new Error("This drawing view closed while creating.");
      version.requests++;
      setLoading(false);
      setError(null);
      setDrawings((current) => [drawing, ...current]);
      services.changed(spaceId);
      return drawing;
    },
    [spaceId, services, version],
  );

  const rename = useCallback(
    async (drawingId: string, title: string) => {
      const current = version.generation;
      const drawing = await services.rename(spaceId, drawingId, title);
      if (current !== version.generation)
        throw new Error("This drawing view closed while renaming.");
      version.requests++;
      setLoading(false);
      setError(null);
      setDrawings((current) => current.map((item) => (item.id === drawingId ? drawing : item)));
      services.changed(spaceId);
      return drawing;
    },
    [spaceId, services, version],
  );

  const remove = useCallback(
    async (drawingId: string) => {
      const current = version.generation;
      await services.remove(spaceId, drawingId);
      if (current !== version.generation) return;
      version.requests++;
      setLoading(false);
      setError(null);
      services.closeDocument(spaceId, drawingId);
      setDrawings((current) => current.filter((item) => item.id !== drawingId));
      services.changed(spaceId);
    },
    [spaceId, services, version],
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
