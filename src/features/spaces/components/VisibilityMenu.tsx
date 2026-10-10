import { Lock, MoreHorizontal } from "lucide-react";
import type { ItemVisibility } from "@/api/spaces/visibility";
import {
  cn,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
  IconButton,
} from "@/shared/ui";

/** A lock and the word, so the layer never rests on the icon alone. */
export function PrivateLabel({ className }: { className?: string }) {
  return (
    <span
      className={cn("inline-flex shrink-0 items-center gap-1 text-xs text-cream-muted", className)}
    >
      <Lock aria-hidden className="size-3" />
      Private
    </span>
  );
}

/**
 * An item's menu, for its owner. Private keeps the item in the Space but shows it only to
 * them and to their own agents on their own asks; the choice shows as a checkmark.
 */
export function VisibilityMenu(props: {
  /** What the menu is for, such as the item's title. */
  label: string;
  visibility: ItemVisibility | undefined;
  onChange: (visibility: ItemVisibility) => void;
  className?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label={`${props.label} menu`} size="sm" className={props.className}>
          <MoreHorizontal aria-hidden />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64" data-misty-layer-portal>
        <DropdownMenuCheckboxItem
          checked={props.visibility === "private"}
          onCheckedChange={(checked) => props.onChange(checked === true ? "private" : "public")}
        >
          <span className="flex flex-col">
            <span>Private</span>
            <span className="text-xs text-cream-muted">
              Only you and your agents on your own asks
            </span>
          </span>
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
