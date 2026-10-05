import type { GlobalAiConversation } from "@/features/global-search/types";
import { Button, Input } from "@/shared/ui";
import { Plus } from "lucide-react";
import { useState } from "react";
import { AgentConversationActions } from "./AgentConversationActions";

export function AgentHistory(props: {
  conversations: GlobalAiConversation[];
  activeId: string;
  disabled: boolean;
  onSelect(id: string): void;
  onNewChat(): void;
}) {
  const [search, setSearch] = useState("");
  const term = search.trim().toLocaleLowerCase();
  const chats = props.conversations.filter((chat) => chat.title.toLocaleLowerCase().includes(term));
  return (
    <div className="agent-history">
      <div className="agent-history-tools">
        <Input
          aria-label="Find a conversation"
          placeholder="Find a conversation"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Button variant="secondary" size="sm" disabled={props.disabled} onClick={props.onNewChat}>
          <Plus size={16} />
          New chat
        </Button>
      </div>
      {chats.map((chat) => {
        const preview = [...chat.messages].reverse().find((message) => message.content)?.content;
        const updated = new Date(chat.updatedAt);
        const validDate = Number.isFinite(updated.getTime());
        return (
          <div key={chat.id} className="flex min-w-0 items-center gap-1">
            <Button
              variant="ghost"
              justify="start"
              className="agent-history-row min-w-0 flex-1"
              aria-current={props.activeId === chat.id ? "true" : undefined}
              aria-pressed={props.activeId === chat.id}
              disabled={props.disabled}
              onClick={() => props.onSelect(chat.id)}
            >
              <span className="agent-history-copy">
                <span>
                  <strong>{chat.title || "Untitled conversation"}</strong>
                  {validDate && (
                    <time dateTime={updated.toISOString()}>
                      {updated.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </time>
                  )}
                </span>
                {preview && <small>{preview}</small>}
              </span>
            </Button>
            <AgentConversationActions conversation={chat} disabled={props.disabled} />
          </div>
        );
      })}
      {!chats.length && (
        <p className="agents-list-note">
          {term ? "No conversations found." : "No conversations yet."}
        </p>
      )}
    </div>
  );
}
