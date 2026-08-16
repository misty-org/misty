import { createDragPreview } from "@/shared/hooks/usePointerReorder";

/**
 * Lifts the dragged file's icon and name under the pointer, like Finder, and
 * dims the row it came from until the drag ends.
 */
export function liftFilePreview(
  source: HTMLElement,
  start: { x: number; y: number },
  name: string,
  count: number,
) {
  const preview = document.createElement("div");
  preview.className = "pointer-reorder-preview explorer-drag-chip";
  preview.setAttribute("aria-hidden", "true");
  preview.inert = true;
  // Freeze the row's real icon so thumbnails and item tones carry over.
  const icon = source.querySelector<HTMLElement>("svg, img");
  if (icon) preview.append(createDragPreview(icon).preview.firstElementChild!);
  const label = document.createElement("span");
  label.className = "explorer-drag-chip-name";
  label.textContent = name;
  preview.append(label);
  const grab = { x: -12, y: -12 };
  if (count > 1) {
    const badge = document.createElement("span");
    badge.className = "explorer-drag-count";
    badge.textContent = String(count);
    preview.append(badge);
  }
  source.dataset.reorderDragging = "true";
  document.body.append(preview);
  const move = (point: { x: number; y: number }) => {
    preview.style.left = `${point.x - grab.x}px`;
    preview.style.top = `${point.y - grab.y}px`;
  };
  move(start);
  return {
    move,
    /** Hidden while the OS owns the drag; it draws its own image. */
    hide: () => (preview.style.visibility = "hidden"),
    remove: () => {
      preview.remove();
      delete source.dataset.reorderDragging;
    },
  };
}
