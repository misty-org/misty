import { Trash2, X } from "lucide-react";
import { Button } from "../controls/Button";
import { IconButton } from "../controls/IconButton";

/** Compact actions for a modifier-selected collection range. */
export function CollectionSelectionBar({
  count,
  busy = false,
  label = "Delete",
  onDelete,
  onClear,
}: {
  count: number;
  busy?: boolean;
  label?: string;
  onDelete: () => void;
  onClear: () => void;
}) {
  if (!count) return null;
  return (
    <div className="mb-3 flex min-h-10 items-center gap-2 rounded-xl bg-charcoal-card px-3 py-2">
      <span className="mr-1 text-xs font-medium">{count} selected</span>
      <Button size="sm" variant="outline" type="button" disabled={busy} onClick={onDelete}>
        <Trash2 size={13} />
        {label}
      </Button>
      <IconButton label="Clear selection" className="ml-auto" disabled={busy} onClick={onClear}>
        <X size={13} />
      </IconButton>
    </div>
  );
}
