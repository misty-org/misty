import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  MenuTrigger,
} from "@/shared/ui";
import { useCollaborationStore } from "./store";
import type { ConversationMode } from "./types";

const modes: { id: ConversationMode; label: string; description: string }[] = [
  { id: "act", label: "Act", description: "Works on the task directly" },
  {
    id: "plan",
    label: "Plan",
    description: "Researches and proposes a plan before changing anything",
  },
];

/**
 * The composer toolbar's mode menu, beside Attach. Plan researches read-only, asks
 * questions and proposes a plan; Act works directly. Shift+Tab in the composer
 * switches too. The next message uses the new mode; a running turn keeps the mode it
 * started in.
 */
export function AgentModeToggle({
  conversationId,
  mode,
  disabled,
}: {
  conversationId?: string;
  mode: ConversationMode;
  disabled?: boolean;
}) {
  return (
    <DropdownMenu>
      <MenuTrigger
        label="Mode"
        value={modes.find((m) => m.id === mode)?.label ?? "Act"}
        title="Mode · Shift+Tab to switch"
        disabled={disabled}
        className="agent-mode-toggle h-7 px-2 text-xs font-normal text-cream-muted"
      />
      <DropdownMenuContent align="start" className="w-72" data-misty-layer-portal>
        <DropdownMenuRadioGroup
          value={mode}
          onValueChange={(next) =>
            void useCollaborationStore.getState().setMode(conversationId, next as ConversationMode)
          }
        >
          {modes.map((option) => (
            <DropdownMenuRadioItem key={option.id} value={option.id}>
              <span className="grid min-w-0 gap-0.5">
                <span>{option.label}</span>
                <span className="text-xs text-cream-muted">{option.description}</span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
