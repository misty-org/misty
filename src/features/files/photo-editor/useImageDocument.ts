import { useCallback, useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { localImageOrigin, readImageEdit, writeImageEdit, type ImageDocParts } from "./imageDoc";
import type { ImageEdit } from "./imageEdit";

type Update = (edit: ImageEdit) => ImageEdit;

/**
 * The shared edit as React state, with this person's own undo and redo. `change` is one step. A
 * drag (a slider, a crop, moving a mark) shows every move through `preview`, so everyone sees it
 * as it happens, and becomes one step at `commit`, so undo takes the whole drag back. Undo only
 * ever takes back this person's own changes, never someone else's.
 */
export function useImageDocument(parts: ImageDocParts, readonly: boolean) {
  const [edit, setEdit] = useState(() => readImageEdit(parts));
  useEffect(() => {
    const sync = () => setEdit(readImageEdit(parts));
    parts.edit.observe(sync);
    parts.adjust.observe(sync);
    parts.marks.observe(sync);
    // Anything that changed between rendering and subscribing shows too.
    sync();
    return () => {
      parts.edit.unobserve(sync);
      parts.adjust.unobserve(sync);
      parts.marks.unobserve(sync);
    };
  }, [parts]);

  const undoRef = useRef<Y.UndoManager | null>(null);
  const [stacks, setStacks] = useState({ undo: 0, redo: 0 });
  useEffect(() => {
    const manager = new Y.UndoManager([parts.edit, parts.adjust, parts.marks], {
      trackedOrigins: new Set([localImageOrigin]),
      // Steps are cut by hand (`change`, `commit`), never by a pause in the middle of a drag.
      captureTimeout: 60_000,
    });
    undoRef.current = manager;
    const sync = () =>
      setStacks({ undo: manager.undoStack.length, redo: manager.redoStack.length });
    manager.on("stack-item-added", sync);
    manager.on("stack-item-popped", sync);
    manager.on("stack-cleared", sync);
    sync();
    return () => {
      if (undoRef.current === manager) undoRef.current = null;
      manager.destroy();
    };
  }, [parts]);

  const gesture = useRef(false);
  const change = useCallback(
    (update: Update) => {
      if (readonly) return;
      gesture.current = false;
      undoRef.current?.stopCapturing();
      writeImageEdit(parts, update(readImageEdit(parts)));
      undoRef.current?.stopCapturing();
    },
    [parts, readonly],
  );
  const preview = useCallback(
    (update: Update) => {
      if (readonly) return;
      if (!gesture.current) {
        undoRef.current?.stopCapturing();
        gesture.current = true;
      }
      writeImageEdit(parts, update(readImageEdit(parts)));
    },
    [parts, readonly],
  );
  const commit = useCallback(() => {
    gesture.current = false;
    undoRef.current?.stopCapturing();
  }, []);
  const undo = useCallback(() => {
    if (readonly) return;
    gesture.current = false;
    undoRef.current?.undo();
  }, [readonly]);
  const redo = useCallback(() => {
    if (readonly) return;
    gesture.current = false;
    undoRef.current?.redo();
  }, [readonly]);
  /** Forgets every step, as once the edit has been saved into the image. */
  const forget = useCallback(() => {
    gesture.current = false;
    undoRef.current?.clear();
  }, []);

  return {
    edit,
    canUndo: !readonly && stacks.undo > 0,
    canRedo: !readonly && stacks.redo > 0,
    change,
    preview,
    commit,
    undo,
    redo,
    forget,
  };
}

export type ImageDocument = ReturnType<typeof useImageDocument>;
