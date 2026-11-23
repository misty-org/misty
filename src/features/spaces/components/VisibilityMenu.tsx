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
} from "@misty/ui";

export function PrivateLabel({ className }: { className?: string }) {
  return (
    <Text
      bare
      size="meta"
      tone="muted"
      className={cn("inline-flex shrink-0 items-center gap-1", className)}
    >
      <Lock aria-hidden />
      Private
    </Text>
  );
}

export function VisibilityMenu(props: {
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
              <Text bare size="meta" tone="muted">
                Only you and your agents on your own asks
              </Text>
            </span>
          }
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
