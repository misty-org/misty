import type { DockDropZone } from "@/features/app-windows";
import { Surface } from "@/shared/ui";
export function DockDropPreview({ zone }: { zone: DockDropZone }) {
  const position =
    zone === "center"
      ? "inset-3"
      : zone === "left"
        ? "inset-y-2 left-2 w-[42%]"
        : zone === "right"
          ? "inset-y-2 right-2 w-[42%]"
          : zone === "up"
            ? "inset-x-2 top-2 h-[42%]"
            : "inset-x-2 bottom-2 h-[42%]";
  return (
    <Surface
      tone="drop"
      edge="strong"
      radius="md"
      className={`pointer-events-none absolute z-50 ${position}`}
    />
  );
}
