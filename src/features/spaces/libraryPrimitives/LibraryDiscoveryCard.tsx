import { useContext } from "react";
import { Pin, type LucideIcon } from "lucide-react";
import { Button } from "@/ui";
import type { LibraryDiscoveryGroup } from "@/models/interfaces/features/spaces/types";
import { AlbumCover } from "./AlbumCover";
import { LibraryCanEditContext } from "./LibraryCanEditContext";

/** A Memory, Trip, date group or duplicate set, shown as a cover-image tile. */
export function LibraryDiscoveryCard({
  spaceId,
  group,
  fallbackIcon: Icon,
  pinned = false,
  onTogglePin,
  onClick,
}: {
  spaceId: string;
  group: LibraryDiscoveryGroup;
  fallbackIcon: LucideIcon;
  pinned?: boolean;
  onTogglePin?: () => void;
  onClick: () => void;
}) {
  const canEdit = useContext(LibraryCanEditContext);

  return (
    <article className="group relative overflow-hidden rounded-xl bg-charcoal-card shadow-xs inset-ring-1 inset-ring-cream/10">
      <Button
        className="block w-full border-0 bg-transparent p-0 text-left"
        type="button"
        onClick={onClick}
      >
        <span className="relative block">
          <AlbumCover spaceId={spaceId} itemId={group.cover_item_id} />
          <span className="absolute left-3 top-3 grid size-8 place-items-center rounded-lg bg-charcoal-workspace text-cream-bright ">
            <Icon size={16} />
          </span>
        </span>
        <span className="block p-3">
          <span className="block truncate text-xs font-medium">{group.title}</span>
          <span className="mt-1 block truncate text-[10px] text-cream-muted">{group.subtitle}</span>
        </span>
      </Button>
      {canEdit && onTogglePin ? (
        <Button
          className={`absolute right-3 top-3 grid size-8 place-items-center rounded-lg border-0 ${pinned ? "bg-charcoal-active text-charcoal-bg" : "bg-charcoal-workspace text-cream-bright opacity-0 group-hover:opacity-100 focus:opacity-100"}`}
          type="button"
          onClick={onTogglePin}
          title={pinned ? "Unpin" : "Pin collection"}
          aria-label={`${pinned ? "Unpin" : "Pin"} ${group.title}`}
        >
          <Pin size={14} fill={pinned ? "currentColor" : "none"} />
        </Button>
      ) : null}
    </article>
  );
}
