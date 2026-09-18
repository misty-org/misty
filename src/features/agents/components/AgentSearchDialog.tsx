import { Activity, History, Plus, Settings, Unplug } from "lucide-react";
import type { AgentProfile } from "@misty/contracts";
import type { GlobalAiConversation } from "@/features/global-search/types";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/shared/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/shared/ui/dialog";
import { AgentAvatar } from "./AgentAvatar";

export function AgentSearchDialog(props: {
  open: boolean;
  onOpenChange(open: boolean): void;
  agents: AgentProfile[];
  conversations: GlobalAiConversation[];
  disabled: boolean;
  onAgent(id: string): void;
  onConversation(conversation: GlobalAiConversation): void;
  onCreate(): void;
  onSettings(): void;
  onActivity(): void;
  onConnections(): void;
}) {
  const choose = (action: () => void) => {
    if (props.disabled) return;
    props.onOpenChange(false);
    action();
  };
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="agent-search-dialog" aria-describedby="agent-search-description">
        <DialogTitle className="sr-only">Search agents and conversations</DialogTitle>
        <DialogDescription id="agent-search-description" className="sr-only">
          Find an agent, conversation, or setting. Use the arrow keys and Enter to open a result.
        </DialogDescription>
        <Command
          label="Search agents and conversations"
          filter={(value, search) =>
            value.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()) ? 1 : 0
          }
        >
          <CommandInput
            autoFocus
            aria-label="Search agents and conversations"
            placeholder="Search"
          />
          <CommandList>
            <CommandEmpty>No results. Try another name or conversation.</CommandEmpty>
            {props.agents.map((agent) => (
              <CommandItem
                key={agent.id}
                value={`${agent.name} ${agent.role} ${agent.id}`}
                disabled={props.disabled}
                onSelect={() => choose(() => props.onAgent(agent.id))}
              >
                <AgentAvatar agent={agent} />
                <span>{agent.name}</span>
              </CommandItem>
            ))}
            {props.conversations.map((conversation) => (
              <CommandItem
                key={conversation.id}
                value={`${conversation.title} ${conversation.id}`}
                disabled={props.disabled}
                onSelect={() => choose(() => props.onConversation(conversation))}
              >
                <History size={18} />
                <span>
                  {conversation.title}
                  <small>Conversation</small>
                </span>
              </CommandItem>
            ))}
            {[
              { label: "Agent settings", icon: Settings, action: props.onSettings },
              { label: "Activity", icon: Activity, action: props.onActivity },
              { label: "Connections", icon: Unplug, action: props.onConnections },
              { label: "Create agent", icon: Plus, action: props.onCreate },
            ].map(({ label, icon: Icon, action }) => (
              <CommandItem
                key={label}
                value={label}
                disabled={props.disabled}
                onSelect={() => choose(action)}
              >
                <Icon size={18} />
                <span>{label}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
