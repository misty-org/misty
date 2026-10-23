import type { SpaceLibraryItem } from "@/api/spaces/dto/entities";
import { cn, Pressable } from "@/shared/ui";
import { Check } from "lucide-react";
import { MistyLibraryPickerThumbnail } from "./MistyLibraryPickerThumbnail";

/** One Library item in the picker grid; a checkmark marks it chosen. */
export function MistyLibraryPickerTile({
  spaceId,
  item,
  selected,
  disabled,
  onToggle,
}: {
  spaceId: string;
  item: SpaceLibraryItem;
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <Pressable
      className={cn(
        "flex items-center",
        "group relative flex-col items-stretch gap-0 overflow-hidden rounded-lg p-0 shadow-xs",
        selected
          ? "ring-2 ring-charcoal-active"
          : "bg-charcoal-card inset-ring-1 inset-ring-cream/10 hover:bg-charcoal-hover",
      )}
      disabled={disabled}
      aria-pressed={selected}
      onClick={onToggle}
    >
      <span className="grid aspect-[4/3] w-full place-items-center overflow-hidden bg-charcoal-card">
        <MistyLibraryPickerThumbnail spaceId={spaceId} item={item} />
      </span>
      <span className="block min-w-0 px-2.5 py-2">
        <span className="block truncate text-xs font-medium">{item.display_name}</span>
        <span className="mt-0.5 block truncate text-[11px] font-normal text-cream-muted">
          {item.file.original_filename}
        </span>
      </span>
      {selected ? (
        <span className="absolute right-2 top-2 grid size-5 place-items-center rounded-md bg-charcoal-active text-cream-bright shadow-xs">
          <Check className="size-3" />
        </span>
      ) : null}
    </Pressable>
  );
}
