import { useEffect, useRef } from "react";
import { markupToolKeys, type EditorMode, type MarkupTool } from "./editorTypes";
import type { ImageEdit } from "./imageEdit";
import type { ImageDocument } from "./useImageDocument";
import type { Viewport } from "./useViewport";

/** What, open over the editor, takes the keys instead: a menu, a list, a popover or a dialog. */
export const overEditor = [
  "[data-radix-popper-content-wrapper] [role='menu']",
  "[data-radix-popper-content-wrapper] [role='listbox']",
  "[data-radix-popper-content-wrapper] [data-slot='popover-content']",
  "[role='alertdialog']",
  "[role='dialog'][data-state='open']",
].join(", ");

/** Controls that Space presses, so holding it doesn't move the image instead. */
const spaceControls =
  "button, [role='button'], [role='radio'], [role='switch'], [role='slider'], [role='checkbox'], [role='tab']";

/** Whether a key press belongs to something being typed in, not to the editor. */
function typing(target: EventTarget | null) {
  return (
    target instanceof Element &&
    Boolean(target.closest("input, textarea, select, [contenteditable='true']"))
  );
}

const arrows: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/** What the keys act on, read fresh at each press. */
export interface PhotoKeyTargets {
  readonly: boolean;
  mode: EditorMode;
  picked: string[];
  edit: ImageEdit;
  natural: { width: number; height: number };
  viewport: Viewport;
  document: ImageDocument;
  saveOver: () => void;
  saveCopy: () => void;
  duplicate: () => void;
  remove: () => void;
  nudge: (dx: number, dy: number) => void;
  /** Turns the image a quarter, and the crop frame with it while cropping. */
  turn: (clockwise: boolean) => void;
  pickTool: (tool: MarkupTool) => void;
  startCrop: () => void;
  applyCrop: () => void;
  selectAll: () => void;
  goPrevious: () => void;
  goNext: () => void;
}

/**
 * The editor's keys (Escape is the overlay's): ⌘Z and ⇧⌘Z undo and redo, ⌘S saves, the zoom
 * keys, ← and → for the neighboring images, the markup tools' letters, C to crop and Enter to
 * keep it, and Space held to move the image. `blocked` while a dialog of the editor's is open.
 */
export function usePhotoKeys(
  targets: PhotoKeyTargets,
  blocked: boolean,
  setPanning: (panning: boolean) => void,
) {
  const latest = useRef(targets);
  useEffect(() => {
    latest.current = targets;
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (blocked || event.defaultPrevented || typing(event.target)) return;
      if (window.document.querySelector(overEditor)) return;
      const k = latest.current;
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      const take = (action: () => void) => {
        event.preventDefault();
        action();
      };
      if (event.key === " ") {
        // Space still presses the button or control in focus.
        if (event.target instanceof Element && event.target.closest(spaceControls)) return;
        event.preventDefault();
        if (!event.repeat) setPanning(true);
        return;
      }
      if (event.key === "Enter" && k.mode === "crop") return take(k.applyCrop);
      if (mod && (key === "=" || key === "+")) return take(k.viewport.zoomIn);
      if (mod && key === "-") return take(k.viewport.zoomOut);
      if (mod && key === "0") return take(k.viewport.fit);
      if (mod && key === "1") return take(() => k.viewport.zoomTo(1));
      // Arrows move picked marks; otherwise ← and → go to the neighboring images.
      if (arrows[event.key] && !mod && !k.picked.length && k.mode !== "crop") {
        if (event.key === "ArrowLeft") take(k.goPrevious);
        else if (event.key === "ArrowRight") take(k.goNext);
        return;
      }
      if (k.readonly) return;
      if (mod && key === "z") return take(event.shiftKey ? k.document.redo : k.document.undo);
      if (mod && key === "y") return take(k.document.redo);
      if (mod && key === "s") return take(event.shiftKey ? k.saveCopy : k.saveOver);
      // ⌘R would reload the window; here it turns the image.
      if (mod && key === "r") return take(() => k.turn(!event.shiftKey));
      if (mod && key === "d") return take(k.duplicate);
      if (mod && key === "a" && k.mode === "markup") return take(k.selectAll);
      if ((event.key === "Delete" || event.key === "Backspace") && k.picked.length)
        return take(k.remove);
      if (arrows[event.key] && k.picked.length && !mod) {
        // One screen pixel, or ten with Shift, in the image's own space.
        const step =
          (event.shiftKey ? 10 : 1) /
          Math.max(1e-9, k.viewport.scale * Math.max(k.natural.width, k.natural.height));
        const [dx, dy] = arrows[event.key];
        return take(() => k.nudge(dx * step, dy * step));
      }
      if (mod || event.altKey) return;
      if (key === "c" && k.mode !== "crop") return take(k.startCrop);
      const tool = (Object.keys(markupToolKeys) as MarkupTool[]).find(
        (id) => markupToolKeys[id].toLowerCase() === key,
      );
      if (tool && k.mode !== "crop") take(() => k.pickTool(tool));
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === " ") setPanning(false);
    };
    const onBlur = () => setPanning(false);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [blocked, setPanning]);
}
