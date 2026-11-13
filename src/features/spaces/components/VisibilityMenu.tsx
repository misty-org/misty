import { Lock, MoreHorizontal } from "lucide-react";
import type { ItemVisibility } from "../api/visibility";
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  IconButton,
  MenuCheckItem,
  Text,
} from "@/shared/ui";

/** A lock and the word, so the layer never rests on the icon alone. */
export function PrivateLabel({ className }: { className?: string }) {
  return (
    <Text
      bare
      tone="muted"
      className={cn("inline-flex shrink-0 items-center gap-1 text-xs", className)}
    >
      <Lock aria-hidden />
      Private
    </Text>
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
        <IconButton label={`${props.label} menu`} className={props.className}>
          <MoreHorizontal aria-hidden />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64" data-misty-layer-portal>
        <MenuCheckItem
          icon={Lock}
          closeOnSelect
          checked={props.visibility === "private"}
          onCheckedChange={(checked) => props.onChange(checked ? "private" : "public")}
          label={
            <span className="flex flex-col">
              <span>Private</span>
              <Text bare tone="muted" className="text-xs">
                Only you and your agents on your own asks
              </Text>
            </span>
          }
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
