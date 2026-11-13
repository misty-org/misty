import { useEffect, useRef, useState, type DragEvent } from "react";
import { registerFileDropZone } from "@/shared/platform/nativeFileDrop";

/**
 * Makes an element take files dropped from the computer's file manager, on every desktop system
 * and in a web preview. Returns the ref to put on the element, whether files are hovering over it,
 * and the handlers for the page's own drag events, which only a browser (not the desktop app)
 * sends for outside files.
 */
export function useFileDropZone<T extends HTMLElement>(
  onFiles: (files: File[]) => void,
  options: { disabled?: boolean; onError?: (message: string) => void } = {},
) {
  const [element, ref] = useState<T | null>(null);
  const [dragging, setDragging] = useState(false);
  const latest = useRef({ onFiles, ...options });
  useEffect(() => {
    latest.current = { onFiles, ...options };
  });

  useEffect(() => {
    if (!element) return;
    return registerFileDropZone({
      element,
      enabled: () => !latest.current.disabled,
      hover: setDragging,
      drop: (files) => latest.current.onFiles(files),
      error: (message) => latest.current.onError?.(message),
    });
  }, [element]);

  const carriesFiles = (event: DragEvent) => event.dataTransfer?.types?.includes("Files") ?? false;
  const handlers = {
    onDragEnter(event: DragEvent<T>) {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      if (!options.disabled) setDragging(true);
    },
    onDragOver(event: DragEvent<T>) {
      if (carriesFiles(event)) event.preventDefault();
    },
    onDragLeave(event: DragEvent<T>) {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
    },
    onDrop(event: DragEvent<T>) {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      setDragging(false);
      if (!options.disabled) onFiles(Array.from(event.dataTransfer.files));
    },
  };
  return { ref, dragging, handlers };
}
