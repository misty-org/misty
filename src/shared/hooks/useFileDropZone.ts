import { useEffect, useRef, useState, type DragEvent } from "react";
import { registerFileDropZone } from "@/shared/platform/nativeFileDrop";

/** Marks an element whose whole box takes files for the drop zone inside it. */
export const FILE_DROP_AREA_ATTRIBUTE = "data-file-drop-area";
/** Set on a drop area while files hover over it; `styles/components.css` highlights it. */
const FILE_DRAGGING_ATTRIBUTE = "data-file-dragging";

const carriesFiles = (event: { dataTransfer: DataTransfer | null }) =>
  event.dataTransfer?.types?.includes("Files") ?? false;

/**
 * Makes an element take files dropped from the computer's file manager, on every desktop system
 * and in a web preview. Returns the ref to put on the element, whether files are hovering over it,
 * and the handlers for the page's own drag events, which only a browser (not the desktop app)
 * sends for outside files.
 *
 * With `area`, the drop target grows to the nearest ancestor marked with
 * `FILE_DROP_AREA_ATTRIBUTE`: files dropped anywhere on it go to this zone, which still shows the
 * hover. Without a marked ancestor the element alone takes them.
 */
export function useFileDropZone<T extends HTMLElement>(
  onFiles: (files: File[]) => void,
  options: { disabled?: boolean; onError?: (message: string) => void; area?: boolean } = {},
) {
  const [element, ref] = useState<T | null>(null);
  const [dragging, setDragging] = useState(false);
  const latest = useRef({ onFiles, ...options });
  useEffect(() => {
    latest.current = { onFiles, ...options };
  });
  const areaElement = options.area
    ? (element?.parentElement?.closest<HTMLElement>(`[${FILE_DROP_AREA_ATTRIBUTE}]`) ?? null)
    : null;

  useEffect(() => {
    const target = areaElement ?? element;
    if (!target) return;
    return registerFileDropZone({
      element: target,
      enabled: () => !latest.current.disabled,
      hover: setDragging,
      drop: (files) => latest.current.onFiles(files),
      error: (message) => latest.current.onError?.(message),
    });
  }, [element, areaElement]);

  // The whole area lights up while files hover over it, not only the element they go to.
  useEffect(() => {
    if (!areaElement || !dragging) return;
    areaElement.setAttribute(FILE_DRAGGING_ATTRIBUTE, "");
    return () => areaElement.removeAttribute(FILE_DRAGGING_ATTRIBUTE);
  }, [areaElement, dragging]);

  // In a browser the area hears the page's own drag events; the element's handlers stand aside.
  useEffect(() => {
    if (!areaElement) return;
    const enter = (event: globalThis.DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      if (!latest.current.disabled) setDragging(true);
    };
    const over = (event: globalThis.DragEvent) => {
      if (carriesFiles(event)) event.preventDefault();
    };
    const leave = (event: globalThis.DragEvent) => {
      if (!areaElement.contains(event.relatedTarget as Node | null)) setDragging(false);
    };
    const drop = (event: globalThis.DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      setDragging(false);
      if (!latest.current.disabled) latest.current.onFiles(Array.from(event.dataTransfer!.files));
    };
    areaElement.addEventListener("dragenter", enter);
    areaElement.addEventListener("dragover", over);
    areaElement.addEventListener("dragleave", leave);
    areaElement.addEventListener("drop", drop);
    return () => {
      areaElement.removeEventListener("dragenter", enter);
      areaElement.removeEventListener("dragover", over);
      areaElement.removeEventListener("dragleave", leave);
      areaElement.removeEventListener("drop", drop);
    };
  }, [areaElement]);

  const handlers = {
    onDragEnter(event: DragEvent<T>) {
      if (areaElement || !carriesFiles(event)) return;
      event.preventDefault();
      if (!options.disabled) setDragging(true);
    },
    onDragOver(event: DragEvent<T>) {
      if (areaElement) return;
      if (carriesFiles(event)) event.preventDefault();
    },
    onDragLeave(event: DragEvent<T>) {
      if (areaElement) return;
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
    },
    onDrop(event: DragEvent<T>) {
      if (areaElement || !carriesFiles(event)) return;
      event.preventDefault();
      setDragging(false);
      if (!options.disabled) onFiles(Array.from(event.dataTransfer.files));
    },
  };
  return { ref, dragging, handlers };
}
