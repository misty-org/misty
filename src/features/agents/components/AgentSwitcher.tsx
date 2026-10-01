import { useState, type Ref } from "react";
import { Check, ChevronDown, LayoutGrid, MessageSquare, Plus } from "lucide-react";
import type { AgentProfile } from "@/shared/schemas";
import type { GlobalAiConversation } from "@/features/global-search/types";
import {
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  Popover,
  PopoverContent,
  PopoverTrigger,
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
  onSelect,
  onCreate,
  onBrowse,
}: {
  agents: AgentProfile[];
  conversations: GlobalAiConversation[];
  selectedAgent?: AgentProfile;
  conversationId: string;
  disabled: boolean;
  restoreTriggerFocus: boolean;
  triggerRef?: Ref<HTMLButtonElement>;
  onSelect(agentId: string, startNew?: boolean, conversationId?: string): void;
  onCreate(): void;
  onBrowse(): void;
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
      <PopoverTrigger asChild>
        <Button
          ref={triggerRef}
          variant="ghost"
          size="sm"
          className="agent-heading-identity"
          aria-label={`Switch agent: ${selectedAgent?.name || "Agents"}`}
          data-agent-navigation-control
        >
          <AgentAvatar agent={selectedAgent} />
          <span className="truncate">{selectedAgent?.name || "Agents"}</span>
          <ChevronDown size={14} />
        </Button>
      </PopoverTrigger>
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
            <CommandGroup heading={query.trim() ? "Conversations" : "Recent conversations"}>
              {(query.trim() ? chats : chats.slice(0, 8)).map(({ chat, agent }) => (
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
                    <span className="block truncate">{chat.title || "Untitled conversation"}</span>
                    <span className="block truncate text-xs text-cream-muted">{agent.name}</span>
                  </span>
                  {chat.id === conversationId && agent.id === selectedAgent?.id && (
                    <Check aria-label="Current conversation" />
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup>
              <CommandItem disabled={disabled} onSelect={() => choose(onCreate)}>
                <Plus />
                New agent
              </CommandItem>
              <CommandItem disabled={disabled} onSelect={() => choose(onBrowse)}>
                <LayoutGrid />
                Browse all agents
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
