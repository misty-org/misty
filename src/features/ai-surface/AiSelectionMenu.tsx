import {
  Button,
  cn,
  menuItemClass,
  menuListClass,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/ui";
import { MessageCircle } from "lucide-react";
import type { ReactNode } from "react";
import type { AiSuggestedAction } from "./types";

export function AiSelectionMenu({
  actions,
  onAction,
  trigger,
}: {
  actions: AiSuggestedAction[];
  onAction: (action: AiSuggestedAction) => void;
  trigger?: ReactNode;
}) {
  if (!actions.length) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        {trigger ?? (
          <Button size="sm" variant="secondary" className="h-7 gap-1.5 text-xs">
            <MessageCircle className="size-3.5" /> Ask Misty
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent className={cn("w-56", menuListClass)} align="start">
        {actions.map((action) => (
          <button
            type="button"
            key={action.id}
            className={menuItemClass}
            onClick={() => onAction(action)}
          >
            {action.label}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
