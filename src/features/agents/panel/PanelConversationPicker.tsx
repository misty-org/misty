import { Plus } from "lucide-react";
import { useState } from "react";
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
import { useMistyStore } from "@/features/misty/useMistyStore";
import {
  activityStateLabels,
  formatActivityTime,
  useAgentActivity,
} from "../page/useAgentActivity";

/**
 * The Misty panel's conversation switch, in its header beside the agent. The panel has no
 * sidebar, so the agent's chats live here, as plain text rows: one per conversation (never per
 * message or run), the title, then the date, with the state in words when its latest run didn't
 * finish well.
 */
export function PanelConversationPicker({
  accountId,
  agentId,
  includeUnassigned = false,
  title,
  disabled,
  onSelect,
  onNew,
  onViewAll,
}: {
  accountId: string;
  agentId?: string;
  /** Also lists conversations with no agent, which belong to the built-in agent. */
  includeUnassigned?: boolean;
  /** The open conversation's title; empty for a new task. */
  title?: string;
  disabled?: boolean;
  onSelect(conversationId: string): void;
  /** Starts a new conversation with this agent. */
  onNew(): void;
  onViewAll(): void;
}) {
  const [open, setOpen] = useState(false);
  const activity = useAgentActivity(accountId, agentId);
  const conversations = useMistyStore((state) => state.conversations);
  // The latest run's state per conversation, for the ones that need a word.
  const states = new Map<string, { state: string; updatedAt: string }>();
  for (const entry of activity.entries) {
    if (entry.parent_run_id || !entry.conversation_id) continue;
    const known = states.get(entry.conversation_id);
    if (!known || entry.updated_at > known.updatedAt)
      states.set(entry.conversation_id, { state: entry.state, updatedAt: entry.updated_at });
  }
  const recent = conversations
    .filter(
      (c) => c.messages.length && (c.agentId === agentId || (!c.agentId && includeUnassigned)),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 30);
  const choose = (action: () => void) => {
    setOpen(false);
    action();
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <MenuTrigger
        kind="popover"
        label="Conversations"
        value={title || "New task"}
        disabled={disabled}
        className="min-w-0 max-w-56 font-medium"
      />
      <PopoverContent align="start" className="w-72 p-0" aria-label="Conversations">
        <Command label="Conversations">
          <CommandInput aria-label="Search conversations" placeholder="Search conversations" />
          <CommandList>
            <CommandEmpty>
              {activity.failed ? "Conversations couldn’t load." : "No conversations yet."}
            </CommandEmpty>
            <CommandGroup>
              {recent.map((conversation) => {
                const run = states.get(conversation.id);
                const time = formatActivityTime(conversation.updatedAt);
                return (
                  <CommandItem
                    key={conversation.id}
                    value={`${conversation.id}:${conversation.title}`}
                    onSelect={() => choose(() => onSelect(conversation.id))}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {conversation.title || "Untitled conversation"}
                    </span>
                    <span className="shrink-0 text-xs text-cream-muted">
                      {!run || run.state === "completed"
                        ? time
                        : `${activityStateLabels[run.state] ?? run.state.replace(/_/g, " ")} · ${time}`}
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
            <CommandGroup>
              <CommandItem onSelect={() => choose(onViewAll)}>View all</CommandItem>
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup>
              <CommandItem onSelect={() => choose(onNew)}>
                <Plus aria-hidden="true" />
                New conversation
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
