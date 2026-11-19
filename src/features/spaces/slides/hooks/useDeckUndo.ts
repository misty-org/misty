import { useEffect, useState } from "react";
import * as Y from "yjs";
import { deckEditOrigin, deckParts } from "../deck/model";

/**
 * This person's own undo history for the deck's structure: slides added, moved, hidden and
 * deleted, layouts, visuals and the theme. Only their changes (`deckEditOrigin`) are tracked,
 * so undo never takes back someone else's work. Text typed into a slot is undone inside its
 * editor, which keeps that slot's own history.
 */
export function useDeckUndo(doc: Y.Doc | null | undefined) {
  const [manager, setManager] = useState<Y.UndoManager | null>(null);
  const [state, setState] = useState({ canUndo: false, canRedo: false });

  useEffect(() => {
    if (!doc) return;
    const parts = deckParts(doc);
    const next = new Y.UndoManager([parts.meta, parts.order, parts.slides], {
      trackedOrigins: new Set([deckEditOrigin]),
      captureTimeout: 400,
    });
    const update = () =>
      setState({ canUndo: next.undoStack.length > 0, canRedo: next.redoStack.length > 0 });
    next.on("stack-item-added", update);
    next.on("stack-item-popped", update);
    next.on("stack-cleared", update);
    setManager(next);
    update();
    return () => {
      next.destroy();
      setManager(null);
      setState({ canUndo: false, canRedo: false });
    };
  }, [doc]);

  return {
    ...state,
    undo: () => manager?.undo(),
    redo: () => manager?.redo(),
    /** Ends the current group, so the next change undoes on its own. */
    stopCapturing: () => manager?.stopCapturing(),
  };
}
