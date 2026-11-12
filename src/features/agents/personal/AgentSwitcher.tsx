import { useState, type Ref } from "react";
import { Plus, Settings } from "lucide-react";
import type { AgentProfile } from "@/shared/schemas";
import type { GlobalAiConversation } from "../conversations/state/conversationTypes";
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
  IconButton,
  MenuTrigger,
  Popover,
  PopoverContent,
} from "@/shared/ui";
import { AgentAvatar } from "./AgentAvatar";
import { NewAgentDialog } from "../engines/NewAgentDialog";
import { offeredAgents } from "./offeredAgents";

export function AgentSwitcher({
  agents,
  selectedAgent,
  disabled,
  restoreTriggerFocus,
  triggerRef,
  className = "agent-heading-identity",
  iconOnly = false,
  onSelect,
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
  /** Only the agent's avatar on the trigger, as in the Misty panel's header. */
  iconOnly?: boolean;
  onSelect(agentId: string, startNew?: boolean, conversationId?: string): void;
  /** Opens the given agent's settings. */
  onSettings(agentId: string): void;
}) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const shown = offeredAgents(agents);
  const choose = (action: () => void) => {
    setOpen(false);
    action();
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <MenuTrigger
        ref={triggerRef}
        kind="popover"
        className={className}
        label={`Switch agent: ${selectedAgent?.name || "Agents"}`}
        value={selectedAgent?.name || "Agents"}
        icon={<AgentAvatar agent={selectedAgent} />}
        iconOnly={iconOnly}
        chevron={!iconOnly}
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
            <CommandGroup>
              {shown.map((agent) => (
                <CommandItem
                  key={agent.id}
                  value={`agent:${agent.id}`}
                  disabled={disabled}
                  icon={
                    <span className="size-6 shrink-0 [&_.agent-avatar]:!size-6">
                      <AgentAvatar agent={agent} />
                    </span>
                  }
                  label={agent.name}
                  shortcut={agent.enabled ? undefined : "Disabled"}
                  checked={agent.id === selectedAgent?.id}
                  end={
                    <IconButton
                      size="sm"
                      label={`${agent.name} settings`}
                      disabled={disabled}
                      onClick={() => choose(() => onSettings(agent.id))}
                    >
                      <Settings />
                    </IconButton>
                  }
                  onSelect={() =>
                    choose(() => {
                      if (agent.id !== selectedAgent?.id) onSelect(agent.id);
                    })
                  }
                />
              ))}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup>
              <CommandItem
                icon={Plus}
                label="New agent"
                disabled={disabled}
                onSelect={() => choose(() => setCreating(true))}
              />
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
      {creating ? (
        <NewAgentDialog
          agents={agents}
          onClose={() => setCreating(false)}
          onCreated={(agentId) => onSelect(agentId)}
        />
      ) : null}
    </Popover>
  );
}
