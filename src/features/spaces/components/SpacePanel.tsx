import type { Space } from "@/api/spaces/dto/entities";
import { SpaceCornerActions } from "./SpaceCornerActions";
import { SpacesMenuButton } from "./SpacesMenuButton";

/**
 * The one panel every Space page has at its top: a flat row, set off by a hairline, that takes its own space,
 * with the Space pill on the left (its arrow switches or creates Spaces) and Home, Chat,
 * members and the Space's settings on the right. It belongs to Space pages only, so the
 * horizontal tab strip stays above it.
 */
export function SpacePanel({ space }: { space: Space }) {
  return (
    <div
      role="toolbar"
      aria-label={`${space.name || "Space"} controls`}
      className="flex h-14 shrink-0 items-center gap-1.5 border-b border-charcoal-border bg-charcoal-bg px-3"
    >
      <SpacesMenuButton />
      <span className="flex-1" />
      <SpaceCornerActions space={space} />
    </div>
  );
}
