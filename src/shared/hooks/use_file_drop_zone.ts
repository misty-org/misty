import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { usePointerDropTarget } from "@misty/ui";
import {
  draggedFiles,
  draggedFilesScope,
  readDraggedFiles,
} from "@/shared/platform/dragged_files";
import { registerFileDropZone } from "@/shared/platform/native_file_drop";

export const FILE_DROP_AREA_ATTRIBUTE = "data-file-drop-area";
const FILE_DRAGGING_ATTRIBUTE = "data-file-dragging";

const carriesFiles = (event: { dataTransfer: DataTransfer | null }) =>
  event.dataTransfer?.types?.includes("Files") ?? false;

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

  const pointerTarget = useMemo(
    () => ({ current: areaElement ?? element }),
    [areaElement, element],
  );
  usePointerDropTarget(pointerTarget, {
    scope: draggedFilesScope,
    hit(_x, _y, drag) {
      const target = pointerTarget.current;
      if (!target || latest.current.disabled || !draggedFiles(drag.id).length) return null;
      return {
        id: drag.id,
        after: false,
        rect: target.getBoundingClientRect(),
        axis: "y",
        box: true,
      };
    },
    drop(drag) {
      void readDraggedFiles(drag.id).then(({ files, failed }) => {
        if (failed.length) latest.current.onError?.(failed[0]!);
        if (files.length && !latest.current.disabled) latest.current.onFiles(files);
      });
    },
  });

  useEffect(() => {
    if (!areaElement || !dragging) return;
    areaElement.setAttribute(FILE_DRAGGING_ATTRIBUTE, "");
    return () => areaElement.removeAttribute(FILE_DRAGGING_ATTRIBUTE);
  }, [areaElement, dragging]);

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
