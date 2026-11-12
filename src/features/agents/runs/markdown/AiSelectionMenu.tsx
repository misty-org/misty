import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  MenuItem,
  MenuTrigger,
} from "@/shared/ui";
import { MessageCircle, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import type { AiSuggestedAction } from "../invocations/invocationTypes";

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
        <MenuTrigger label="Ask an agent" variant="secondary" size="sm" icon={MessageCircle} />
      )}
      <DropdownMenuContent align="start" width="md">
        {actions.map((action) => (
          <MenuItem
            key={action.id}
            icon={Sparkles}
            label={action.label}
            onSelect={() => onAction(action)}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
