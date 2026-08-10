import { spacesApi } from "@/api/spaces/api";
import type {
  SpaceLibraryItem,
  SpaceMember,
  SpaceStudioResource,
} from "@/api/spaces/dto/interfaces/types";
import type { ChatComposerSuggestion } from "@/api/spaces/dto/types/SpaceChat";
import { useEffect, useMemo, useState } from "react";

const MAX_SUGGESTIONS = 24;

/**
 * The `@` autocomplete: Agents, people, then unattached Library items.
 *
 * Library items are only offered while there is room left in the attachment
 * budget, so the list never suggests something that cannot be added.
 */
export function useChatSuggestions(options: {
  spaceId: string;
  members: SpaceMember[];
  agents: SpaceStudioResource[];
  currentUserId: string | undefined;
  canBrowseLibrary: boolean;
  canReadLibrary: boolean;
  selectedLibraryIds: string[];
  attachmentSlotsLeft: number;
}) {
  const { members, agents, currentUserId, canBrowseLibrary, selectedLibraryIds } = options;
  const [libraryItems, setLibraryItems] = useState<SpaceLibraryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (!options.canReadLibrary) {
      setLibraryItems([]);
      return;
    }
    setLoading(true);
    setError("");
    void spacesApi
      .libraryItems(options.spaceId)
      .then((result) => setLibraryItems(result.items))
      .catch((reason: unknown) => {
        setLibraryItems([]);
        setError(reason instanceof Error ? reason.message : "Library items could not be loaded.");
      })
      .finally(() => setLoading(false));
  }, [options.canReadLibrary, options.spaceId]);

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
    const agentSuggestions: ChatComposerSuggestion[] = agents.map((agent) => ({
      kind: "agent",
      id: agent.id,
      label: agent.name,
      detail: agent.creator_user_id === currentUserId ? "Your Agent" : "Shared Agent",
    }));
    const library: ChatComposerSuggestion[] =
      canBrowseLibrary && options.attachmentSlotsLeft > 0
        ? libraryItems
            .filter((item) => !selectedLibraryIds.includes(item.id))
            .map((item) => ({
              kind: "library",
              id: item.id,
              label: item.display_name,
              detail: item.file.original_filename,
              item,
            }))
        : [];
    return [...agentSuggestions, ...people, ...library]
      .filter(
        (item) => !needle || `${item.label} ${item.detail}`.toLocaleLowerCase().includes(needle),
      )
      .slice(0, MAX_SUGGESTIONS);
  }, [
    agents,
    canBrowseLibrary,
    currentUserId,
    libraryItems,
    members,
    options.attachmentSlotsLeft,
    query,
    selectedLibraryIds,
  ]);

  return {
    libraryItems,
    setLibraryItems,
    suggestions,
    loading,
    error,
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
