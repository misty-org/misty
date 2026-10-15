import { Flag } from "lucide-react";
import { useState } from "react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  MenuTrigger,
  Toggle,
} from "@/shared/ui";
import { AgentGoalDialog } from "./AgentGoalDialog";
import { permissionModeLabel, permissionModes, setPermissionMode } from "./permissionMode";
import { useCollaborationStore } from "./store";
import type { ConversationMode, PermissionMode } from "./types";

/**
 * Plan, on or off. Plan researches read-only, asks questions and proposes a plan;
 * off, the agent does the work. Shift+Tab in the composer switches too. The next
 * message uses the new mode; a running turn keeps the mode it started in.
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
    <Toggle
      size="sm"
      variant="outline"
      className="agent-mode-toggle h-7 px-2 text-xs font-normal"
      aria-label="Plan"
      title="Plan · Shift+Tab to switch"
      pressed={mode === "plan"}
      disabled={disabled}
      onPressedChange={(plan) =>
        void useCollaborationStore.getState().setMode(conversationId, plan ? "plan" : "act")
      }
    >
      Plan
    </Toggle>
  );
}

/**
 * Ask or Auto for this chat, with one line each on what it does. Ask pauses
 * before every change; Auto continues where the person remembered an approval.
 */
export function AgentPermissionMenu({
  conversationId,
  permission,
  disabled,
}: {
  conversationId?: string;
  permission: PermissionMode;
  disabled?: boolean;
}) {
  return (
    <DropdownMenu>
      <MenuTrigger
        label="Permissions"
        value={permissionModeLabel(permission)}
        disabled={disabled}
        className="agent-permission-menu h-7 px-2 text-xs font-normal text-cream-muted"
      />
      <DropdownMenuContent align="start" className="w-72" data-misty-layer-portal>
        <DropdownMenuRadioGroup
          value={permission}
          onValueChange={(next) => void setPermissionMode(conversationId, next as PermissionMode)}
        >
          {permissionModes.map((option) => (
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

/** The conversation's goal: a persistent objective that keeps working across turns. */
export function AgentGoalButton({ conversationId }: { conversationId?: string }) {
  const [open, setOpen] = useState(false);
  const goal = useCollaborationStore((s) =>
    conversationId ? s.byConversation[conversationId]?.goal : undefined,
  );
  const active = goal?.status === "pursuing" || goal?.status === "paused";
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 max-w-40 px-2 text-xs font-normal text-cream-muted"
        disabled={!conversationId}
        title={conversationId ? undefined : "Start a conversation, then set a goal"}
        onClick={() => setOpen(true)}
      >
        <Flag className="size-3.5" aria-hidden="true" />
        <span className="truncate">{active && goal ? goal.objective : "Set a goal"}</span>
      </Button>
      <AgentGoalDialog conversationId={conversationId} open={open} onOpenChange={setOpen} />
    </>
  );
}
