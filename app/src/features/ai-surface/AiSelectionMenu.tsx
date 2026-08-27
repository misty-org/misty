import { Button, Popover, PopoverContent, PopoverTrigger } from "@/shared/ui";
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
          <Button type="button" size="sm" variant="secondary" className="h-7 gap-1.5 text-xs">
            <MessageCircle className="size-3.5" /> Ask Misty
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-56 p-1" align="start">
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            className="flex w-full rounded-md px-2.5 py-2 text-left text-xs hover:bg-charcoal-hover"
            onClick={() => onAction(action)}
          >
            {action.label}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
