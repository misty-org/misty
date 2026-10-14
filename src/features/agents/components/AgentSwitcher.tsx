import { useState, type Ref } from "react";
import { Check, Plus, SlidersHorizontal } from "lucide-react";
import type { AgentProfile } from "@/shared/schemas";
import type { GlobalAiConversation } from "@/features/global-search/types";
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
  MenuTrigger,
  Popover,
  PopoverContent,
} from "@/shared/ui";
import { AgentAvatar } from "./AgentAvatar";

export function AgentSwitcher({
  agents,
  selectedAgent,
  disabled,
  restoreTriggerFocus,
  triggerRef,
  className = "agent-heading-identity",
  onSelect,
  onCreate,
  onSettings,
}: {
  agents: AgentProfile[];
  conversations: GlobalAiConversation[];
  selectedAgent?: AgentProfile;
  conversationId: string;
  disabled: boolean;
  restoreTriggerFocus: boolean;
  triggerRef?: Ref<HTMLButtonElement>;
  className?: string;
  onSelect(agentId: string, startNew?: boolean, conversationId?: string): void;
  onCreate(): void;
  /** Opens the selected agent's settings. */
  onSettings(): void;
}) {
  const [open, setOpen] = useState(false);
  const choose = (action: () => void) => {
    setOpen(false);
    action();
  };
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
    >
      <MenuTrigger
        ref={triggerRef}
        kind="popover"
        className={className}
        label={`Switch agent: ${selectedAgent?.name || "Agents"}`}
        value={selectedAgent?.name || "Agents"}
        icon={<AgentAvatar agent={selectedAgent} />}
        data-agent-navigation-control
      />
      <PopoverContent
        align="start"
        className="w-80 p-0"
        aria-label="Switch agent"
        data-agent-navigation-control
        onCloseAutoFocus={(event) => {
          if (!restoreTriggerFocus) event.preventDefault();
        }}
      >
        <Command label="Switch agent">
          <CommandList>
            <CommandGroup heading="Agents">
              {agents.map((agent) => (
                <CommandItem
                  key={agent.id}
                  value={`agent:${agent.id}`}
                  disabled={disabled}
                  onSelect={() =>
                    choose(() => {
                      if (agent.id !== selectedAgent?.id) onSelect(agent.id);
                    })
                  }
                >
                  <span className="size-6 shrink-0 [&_.agent-avatar]:!size-6">
                    <AgentAvatar agent={agent} />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{agent.name}</span>
                  {!agent.enabled && <span className="text-xs text-cream-muted">Disabled</span>}
                  {agent.id === selectedAgent?.id && <Check aria-label="Current agent" />}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup>
              <CommandItem disabled={disabled} onSelect={() => choose(onCreate)}>
                <Plus />
                New agent
              </CommandItem>
              {selectedAgent && (
                <CommandItem disabled={disabled} onSelect={() => choose(onSettings)}>
                  <SlidersHorizontal />
                  {selectedAgent.name} settings
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
