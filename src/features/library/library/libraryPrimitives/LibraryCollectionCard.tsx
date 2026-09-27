import { Button, cn, IconButton } from "@/shared/ui";
import { ChevronLeft, ChevronRight, Pin, type LucideIcon } from "lucide-react";
import { useContext } from "react";
import { LibraryCanEditContext } from "./LibraryCanEditContext";

const cardClass =
  "group relative overflow-hidden rounded-xl bg-charcoal-card shadow-xs inset-ring-1 inset-ring-cream/10";
export interface LibraryCollectionCardProps {
  icon: LucideIcon;
  label: string;
  count: number;
  disabled?: boolean;
  pinned?: boolean;
  onClick?: () => void;
  onTogglePin?: () => void;
  onMoveEarlier?: () => void;
  onMoveLater?: () => void;
}

/** A built-in collection tile, with pin and reorder controls for editors. */
export function LibraryCollectionCard({
  icon: Icon,
  label,
  count,
  disabled = false,
  pinned = false,
  onClick,
  onTogglePin,
  onMoveEarlier,
  onMoveLater,
}: LibraryCollectionCardProps) {
  const canEdit = useContext(LibraryCanEditContext);

  return (
    <article className={cardClass}>
      <Button
        className="block w-full border-0 bg-transparent p-4 text-left disabled:opacity-40"
        type="button"
        disabled={disabled}
        onClick={onClick}
      >
        <Icon size={22} />
        <p className="mb-0 mt-3 truncate text-xs font-medium">{label}</p>
        <p className="mb-0 mt-1 text-[10px] text-cream-muted">{count} items</p>
      </Button>

      {canEdit && onTogglePin && !disabled ? (
        <IconButton
          label={`${pinned ? "Unpin" : "Pin"} ${label}`}
          tooltip={pinned ? "Unpin" : "Pin collection"}
          aria-pressed={pinned}
          className={cn(
            "absolute right-2 top-2",
            !pinned && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
          )}
          onClick={onTogglePin}
        >
          <Pin size={13} fill={pinned ? "currentColor" : "none"} />
        </IconButton>
      ) : null}

      {canEdit && (onMoveEarlier || onMoveLater) ? (
        <span className="absolute bottom-2 right-2 flex gap-0.5 opacity-0 focus-within:opacity-100 group-hover:opacity-100">
          {onMoveEarlier ? (
            <IconButton
              size="xs"
              label={`Move ${label} earlier`}
              tooltip="Move earlier"
              onClick={onMoveEarlier}
            >
              <ChevronLeft size={12} />
            </IconButton>
          ) : null}
          {onMoveLater ? (
            <IconButton
              size="xs"
              label={`Move ${label} later`}
              tooltip="Move later"
              onClick={onMoveLater}
            >
              <ChevronRight size={12} />
            </IconButton>
          ) : null}
        </span>
      ) : null}
    </article>
  );
}
