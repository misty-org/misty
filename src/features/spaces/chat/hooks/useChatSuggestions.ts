import type { SpaceMember } from "../../api/dto/entities";
import type { ChatComposerSuggestion } from "../../api/dto/space-chat";
import type { MentionableAgent } from "../useSpaceMessageSpansStore";
import { useMemo, useState } from "react";

const MAX_SUGGESTIONS = 24;

/**
 * The `@` autocomplete: people, then the roles the person may mention, then their own agents.
 * Mentioning one of your agents runs it on your computer; nobody else's agents are offered.
 */
export function useChatSuggestions(options: {
  spaceId: string;
  members: SpaceMember[];
  agents?: readonly MentionableAgent[];
  /** The roles the person may @mention here. */
  roles?: readonly { id: string; name: string; color: string }[];
  currentUserId: string | undefined;
}) {
  const { members, currentUserId } = options;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const suggestions = useMemo<ChatComposerSuggestion[]>(() => {
    const needle = query.trim().toLocaleLowerCase();
    const people: ChatComposerSuggestion[] = members
      .filter((member) => member.user_id !== currentUserId)
      .map((member) => ({
        kind: "member",
        id: member.user_id,
        label: member.name,
        detail: member.email,
      }));
    const agents: ChatComposerSuggestion[] = (options.agents ?? []).map((agent) => ({
      kind: "agent",
      id: agent.agent_id,
      label: agent.agent_name,
      detail: "Your agent",
    }));
    const roles: ChatComposerSuggestion[] = (options.roles ?? []).map((role) => ({
      kind: "role",
      id: role.id,
      label: role.name,
      detail: "Role",
      color: role.color,
    }));
    return [...people, ...roles, ...agents]
      .filter(
        (item) => !needle || `${item.label} ${item.detail}`.toLocaleLowerCase().includes(needle),
      )
      .slice(0, MAX_SUGGESTIONS);
  }, [currentUserId, members, options.agents, options.roles, query]);

  return {
    suggestions,
    open,
    setOpen,
    query,
    setQuery,
    activeIndex,
    setActiveIndex,
    openAt: (nextQuery = "") => {
      setQuery(nextQuery);
      setActiveIndex(0);
      setOpen(true);
    },
    close: () => {
      setOpen(false);
      setQuery("");
    },
  };
}

export type ChatSuggestionsState = ReturnType<typeof useChatSuggestions>;
