import { Button } from "@/shared/ui";
import { ChevronLeft, ChevronRight, Pin, type LucideIcon } from "lucide-react";
import { useContext } from "react";
import { LibraryCanEditContext } from "./LibraryCanEditContext";

const cardClass =
  "group relative overflow-hidden rounded-xl bg-charcoal-card shadow-xs inset-ring-1 inset-ring-cream/10";
const nudgeClass =
  "grid size-6 place-items-center rounded-md border-0 bg-charcoal-card text-cream-muted";

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
        <Button
          className={`absolute right-2 top-2 grid size-7 place-items-center rounded-lg border-0 ${pinned ? "bg-charcoal-hover text-cream" : "bg-transparent text-cream-muted opacity-0 group-hover:opacity-100 focus:opacity-100"}`}
          type="button"
          onClick={onTogglePin}
          title={pinned ? "Unpin" : "Pin collection"}
          aria-label={`${pinned ? "Unpin" : "Pin"} ${label}`}
        >
          <Pin size={13} fill={pinned ? "currentColor" : "none"} />
        </Button>
      ) : null}

      {canEdit && (onMoveEarlier || onMoveLater) ? (
        <span className="absolute bottom-2 right-2 flex gap-0.5 opacity-0 focus-within:opacity-100 group-hover:opacity-100">
          {onMoveEarlier ? (
            <Button
              className={nudgeClass}
              type="button"
              onClick={onMoveEarlier}
              title="Move earlier"
              aria-label={`Move ${label} earlier`}
            >
              <ChevronLeft size={12} />
            </Button>
          ) : null}
          {onMoveLater ? (
            <Button
              className={nudgeClass}
              type="button"
              onClick={onMoveLater}
              title="Move later"
              aria-label={`Move ${label} later`}
            >
              <ChevronRight size={12} />
            </Button>
          ) : null}
        </span>
      ) : null}
    </article>
  );
}
