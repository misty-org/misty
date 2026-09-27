import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  MenuItem,
  MenuTrigger,
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
    <DropdownMenu modal={false}>
      {trigger ? (
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      ) : (
        <MenuTrigger
          label="Ask Misty"
          variant="secondary"
          icon={<MessageCircle className="size-3.5" />}
          className="h-7 text-xs"
        />
      )}
      <DropdownMenuContent align="start" width="md">
        {actions.map((action) => (
          <MenuItem key={action.id} label={action.label} onSelect={() => onAction(action)} />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
