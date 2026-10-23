import { useState, type Ref } from "react";
import { Check, Plus, Settings } from "lucide-react";
import type { AgentProfile } from "@/shared/schemas";
import type { GlobalAiConversation } from "@/features/misty/types";
import {
  cn,
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
import { agentsByHomeSpace } from "./agentHomeSpaces";

export function AgentSwitcher({
  agents,
  selectedAgent,
  disabled,
  restoreTriggerFocus,
  triggerRef,
  className = "agent-heading-identity",
  iconOnly = false,
  onSelect,
  onCreate,
  onSettings,
  spaces,
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
  /** The Agents page groups agents under their home Space; the quick panel just lists them. */
  spaces?: ReadonlyArray<{ id: string; name: string; is_default?: boolean }>;
  onSelect(agentId: string, startNew?: boolean, conversationId?: string): void;
  onCreate(): void;
  /** Opens the given agent's settings. */
  onSettings(agentId: string): void;
}) {
  const [open, setOpen] = useState(false);
  const choose = (action: () => void) => {
    setOpen(false);
    action();
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <MenuTrigger
        ref={triggerRef}
        kind="popover"
        className={cn(className, iconOnly && "[&_span.truncate]:sr-only")}
        label={`Switch agent: ${selectedAgent?.name || "Agents"}`}
        value={selectedAgent?.name || "Agents"}
        icon={<AgentAvatar agent={selectedAgent} />}
        chevron={!iconOnly}
        title={iconOnly ? selectedAgent?.name || "Agents" : undefined}
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
            {agentsByHomeSpace(agents, spaces).map((group) => (
              <CommandGroup key={group.id} heading={group.name}>
                {group.agents.map((agent) => (
                  <CommandItem
                    key={agent.id}
                    value={`agent:${agent.id}`}
                    disabled={disabled}
                    className="group"
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
                    <span className="relative flex size-6 shrink-0 items-center justify-center">
                      {agent.id === selectedAgent?.id && (
                        <Check
                          aria-label="Current agent"
                          className="group-hover:invisible group-data-[selected=true]:invisible"
                        />
                      )}
                      <IconButton
                        label={`${agent.name} settings`}
                        disabled={disabled}
                        className={cn(
                          "absolute inset-0 !h-auto !w-auto opacity-0 focus-visible:opacity-100",
                          "group-hover:opacity-100 group-data-[selected=true]:opacity-100",
                        )}
                        onClick={(event) => {
                          event.stopPropagation();
                          choose(() => onSettings(agent.id));
                        }}
                      >
                        <Settings className="size-4" />
                      </IconButton>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
            <CommandSeparator />
            <CommandGroup>
              <CommandItem disabled={disabled} onSelect={() => choose(onCreate)}>
                <Plus />
                New agent
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
