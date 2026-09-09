import { useEffect, useRef } from "react";

export function useRoadmapAutosave<T>(draft: T, onSave: (value: T) => void, onDirty: () => void) {
  const dirty = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const saveRef = useRef(onSave);
  const latestDraft = useRef(draft);
  saveRef.current = onSave;
  latestDraft.current = draft;

  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      if (dirty.current) {
        dirty.current = false;
        saveRef.current(latestDraft.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!dirty.current) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      dirty.current = false;
      saveRef.current(draft);
    }, 650);
    return () => window.clearTimeout(timer.current);
  }, [draft]);

  return {
    markDirty: () => {
      dirty.current = true;
      onDirty();
    },
    flush: () => {
      if (!dirty.current) return;
      dirty.current = false;
      window.clearTimeout(timer.current);
      saveRef.current(draft);
    },
  };
}
