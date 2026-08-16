import type { GlobalAiConversation } from "@/features/global-search/types";
import type { AgentProfile } from "@/shared/schemas";
import { Button, IconButton, Input } from "@/shared/ui";
import { CalendarClock, MessageSquare, Plus, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AgentConversationActions } from "./AgentConversationActions";
import { AgentAvatar } from "./AgentAvatar";

export function AgentWorkspaceRoster(props: {
  id: string;
  agents: AgentProfile[];
  conversations: GlobalAiConversation[];
  selectedId?: string;
  loading: boolean;
  disabled: boolean;
  open: boolean;
  onSelect(id: string, startNew?: boolean, conversationId?: string): void;
  onNewChat(): void;
  onCreate(): void;
  onClose(): void;
  onScheduled?(): void;
}) {
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (props.open) searchRef.current?.focus();
  }, [props.open]);
  const term = search.trim().toLocaleLowerCase();
  const matches = (agent: AgentProfile, c: GlobalAiConversation) =>
    c.agentId === agent.id || (!c.agentId && agent.system_managed);
  const agents = props.agents.filter(
    (agent) => !term || agent.name.toLocaleLowerCase().includes(term),
  );
  const chats = term
    ? props.conversations.filter(
        (c) =>
          c.title.toLocaleLowerCase().includes(term) &&
          props.agents.some((agent) => matches(agent, c)),
      )
    : [];
  return (
    <aside
      className="agents-roster"
      aria-label="Your agents"
      id={props.id}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        if (search) setSearch("");
        else props.onClose();
      }}
    >
      <header
        className="agents-roster-heading"
        data-tauri-drag-region
        data-misty-window-titlebar-region="true"
      >
        <div className="agents-roster-search">
          <Search size={16} aria-hidden="true" />
          <Input
            ref={searchRef}
            aria-label="Search agents and chats"
            placeholder="Search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <IconButton
          data-agent-navigation-control
          label="New chat"
          disabled={props.disabled}
          onClick={props.onNewChat}
        >
          <Plus size={16} />
        </IconButton>
        <IconButton
          className="agents-roster-back"
          label="Back to conversation"
          onClick={props.onClose}
        >
          <X size={16} />
        </IconButton>
      </header>
      {props.onScheduled && (
        <Button
          data-agent-navigation-control
          variant="ghost"
          justify="start"
          className="mb-2 w-full gap-2"
          disabled={props.disabled}
          onClick={props.onScheduled}
        >
          <CalendarClock size={16} />
          Scheduled
        </Button>
      )}
      <div className="agents-roster-list misty-transient-scrollbar">
        {props.loading && !props.agents.length && (
          <p className="agents-list-note" role="status">
            Loading agents…
          </p>
        )}
        {agents.map((agent) => {
          const latest = props.conversations.find((c) => matches(agent, c));
          return (
            <Button
              data-agent-navigation-control
              key={agent.id}
              variant="ghost"
              justify="start"
              className="agent-roster-row"
              aria-label={agent.name}
              aria-pressed={props.selectedId === agent.id}
              disabled={props.disabled}
              onClick={() => props.onSelect(agent.id)}
            >
              <AgentAvatar agent={agent} />
              <span className="agent-roster-copy">
                <span className="truncate">{agent.name}</span>
                {latest?.title && <span className="agent-roster-preview">{latest.title}</span>}
              </span>
            </Button>
          );
        })}
        {chats.map((chat) => (
          <Button
            data-agent-navigation-control
            key={chat.id}
            variant="ghost"
            justify="start"
            className="agent-search-result"
            disabled={props.disabled}
            onClick={() => {
              const agent = props.agents.find((a) => matches(a, chat));
              if (agent) props.onSelect(agent.id, false, chat.id);
            }}
          >
            <MessageSquare size={14} />
            <span className="truncate">{chat.title || "Untitled conversation"}</span>
          </Button>
        ))}
        {term && !agents.length && !chats.length && (
          <p className="agents-list-note" role="status">
            No results.
          </p>
        )}
        {!props.loading && !props.agents.length && (
          <Button data-agent-navigation-control variant="ghost" onClick={props.onCreate}>
            Create an agent
          </Button>
        )}
      </div>
    </aside>
  );
}

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
