import { useState, type Ref } from "react";
import { Check, MessageSquare, Plus, SlidersHorizontal } from "lucide-react";
import type { AgentProfile } from "@/shared/schemas";
import type { GlobalAiConversation } from "@/features/global-search/types";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
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
  conversations,
  selectedAgent,
  conversationId,
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
  const [query, setQuery] = useState("");
  const chats = conversations
    .flatMap((chat) => {
      const agent = agents.find(
        (a) => a.id === chat.agentId || (!chat.agentId && a.system_managed),
      );
      return agent ? [{ chat, agent }] : [];
    })
    .sort((a, b) => b.chat.updatedAt.localeCompare(a.chat.updatedAt));
  const choose = (action: () => void) => {
    setOpen(false);
    action();
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setQuery("");
      }}
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
        aria-label="Switch agent or conversation"
        data-agent-navigation-control
        onCloseAutoFocus={(event) => {
          if (!restoreTriggerFocus) event.preventDefault();
        }}
      >
        <Command label="Switch agent or conversation">
          <CommandInput
            autoFocus
            aria-label="Find agents and conversations"
            placeholder="Find agents and conversations…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>No agents or conversations found.</CommandEmpty>
            <CommandGroup heading="Agents">
              {agents.map((agent) => (
                <CommandItem
                  key={agent.id}
                  value={`agent:${agent.id}`}
                  keywords={[agent.name]}
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
            {/* Conversations join the list only while searching; the sidebar lists recents. */}
            {query.trim() && (
              <CommandGroup heading="Conversations">
                {chats.map(({ chat, agent }) => (
                  <CommandItem
                    key={chat.id}
                    value={`conversation:${chat.id}`}
                    keywords={[chat.title || "Untitled conversation", agent.name]}
                    disabled={disabled}
                    onSelect={() =>
                      choose(() => {
                        if (chat.id !== conversationId || agent.id !== selectedAgent?.id)
                          onSelect(agent.id, false, chat.id);
                      })
                    }
                  >
                    <MessageSquare />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">
                        {chat.title || "Untitled conversation"}
                      </span>
                      <span className="block truncate text-xs text-cream-muted">{agent.name}</span>
                    </span>
                    {chat.id === conversationId && agent.id === selectedAgent?.id && (
                      <Check aria-label="Current conversation" />
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
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
