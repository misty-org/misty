import { ClipboardList, Flag, Shield, ShieldCheck } from "lucide-react";
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  MenuTrigger,
} from "@/shared/ui";
import { AgentGoalDialog } from "./AgentGoalDialog";
import { permissionModeLabel, permissionModes, setPermissionMode } from "./permissionMode";
import { useCollaborationStore } from "./store";
import type { ConversationMode, PermissionMode } from "./types";

type Mode = PermissionMode | "plan";

const modeIcons = { ask: Shield, auto: ShieldCheck, plan: ClipboardList } as const;

/**
 * How the agent works in this chat, in one menu: Manual pauses before every change, Auto
 * continues where an approval was remembered, and Plan researches read-only and proposes a
 * plan. Goal sits at the bottom. Shift+Tab in the composer switches Plan too. The next
 * message uses the new mode; a running turn keeps the mode it started in.
 */
export function AgentModeMenu({
  conversationId,
  mode,
  permission,
  disabled,
}: {
  conversationId?: string;
  mode: ConversationMode;
  permission: PermissionMode;
  disabled?: boolean;
}) {
  const [goalOpen, setGoalOpen] = useState(false);
  const goal = useCollaborationStore((s) =>
    conversationId ? s.byConversation[conversationId]?.goal : undefined,
  );
  const active = goal?.status === "pursuing" || goal?.status === "paused";
  const current: Mode = mode === "plan" ? "plan" : permission;
  const label = current === "plan" ? "Plan" : permissionModeLabel(permission);
  const Icon = modeIcons[current];
  const choose = (next: Mode) => {
    const store = useCollaborationStore.getState();
    if (next === "plan") return void store.setMode(conversationId, "plan");
    void store.setMode(conversationId, "act");
    void setPermissionMode(conversationId, next);
  };
  return (
    <>
      <DropdownMenu>
        <MenuTrigger
          label="Mode"
          title={`Mode: ${label} · Shift+Tab switches Plan`}
          icon={<Icon aria-hidden className="size-4 shrink-0" />}
          value={label}
          chevron={false}
          disabled={disabled}
          className="agent-strip-chip"
        />
        <DropdownMenuContent align="start" className="w-48" data-misty-layer-portal>
          <DropdownMenuRadioGroup value={current} onValueChange={(next) => choose(next as Mode)}>
            {permissionModes.map((option) => (
              <DropdownMenuRadioItem key={option.id} value={option.id}>
                {option.label}
              </DropdownMenuRadioItem>
            ))}
            <DropdownMenuRadioItem value="plan">Plan</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!conversationId} onSelect={() => setGoalOpen(true)}>
            <Flag aria-hidden />
            <span className="min-w-0 flex-1 truncate">Goal</span>
            <span className="max-w-24 truncate text-xs text-cream-muted">
              {active && goal ? goal.objective : "None"}
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AgentGoalDialog conversationId={conversationId} open={goalOpen} onOpenChange={setGoalOpen} />
    </>
  );
}
