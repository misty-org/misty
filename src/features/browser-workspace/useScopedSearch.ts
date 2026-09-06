import { useEffect, useState } from "react";
import { useAuth } from "@/features/auth";
import { useSpacesStore } from "@/features/spaces/core";
import { usePersonalAgentsStore } from "@/features/agents/personalAgentsStore";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { useBrowserDownloadsStore } from "@/features/browser";
import { useWorkspaceStore } from "@/features/workspace";
import { kuraInstalled } from "@/native/kura";
import type { SearchScope } from "./bangs/types";
import { kuraSearchResult, searchAgents, type ScopedSearchResult } from "./scopedSearchSources";
import {
  searchBookmarkLibrary,
  searchBrowserHistory,
  searchDownloads,
  searchOpenTabs,
} from "./scopedSources/browserLibrary";
import { searchExtensions, searchSettingsPages } from "./scopedSources/mistyPlaces";
import {
  searchEverythingInSpaces,
  searchSpaceChat,
  searchSpaceNotes,
  searchSpaceTasks,
} from "./scopedSources/spaceContent";
export type { ScopedSearchResult } from "./scopedSearchSources";

type Spaces = ReturnType<typeof useSpacesStore.getState>["spaces"];
type Source = (
  query: string,
  spaces: Spaces,
) => ScopedSearchResult[] | Promise<ScopedSearchResult[]>;

const debounceMs = 180;
const none: never[] = [];

/** Scopes that answer from one function. Files (handed to Kura) and agents have their own paths below. */
const sources: Partial<Record<SearchScope, Source>> = {
  spaces: searchEverythingInSpaces,
  notes: searchSpaceNotes,
  tasks: searchSpaceTasks,
  chat: searchSpaceChat,
  bookmarks: searchBookmarkLibrary,
  history: searchBrowserHistory,
  tabs: searchOpenTabs,
  downloads: searchDownloads,
  settings: searchSettingsPages,
  extensions: searchExtensions,
};

const spaceScopes = new Set<SearchScope>(["spaces", "notes", "tasks", "chat"]);

/**
 * The default scope is answered by the address bar's providers, not here.
 * Files searches are handed to Kura, the separate file manager. Responses for
 * stale queries are dropped, and a
 * refresh keeps the current rows until new ones arrive.
 */
export function useScopedSearch(scope: SearchScope, query: string, open = true) {
  const { user } = useAuth();
  // The dialog stays mounted while closed. Subscribe only to the open scope's sources, so a
  // streaming answer (which rewrites conversations per token) does not re-render it.
  const spaces = useSpacesStore((state) => (open && spaceScopes.has(scope) ? state.spaces : none));
  const agents = usePersonalAgentsStore((state) =>
    open && scope === "agents" ? state.agents : none,
  );
  const conversations = useMistyStore((state) =>
    open && scope === "agents" ? state.conversations : none,
  );
  // Rerun when what a scope lists changes underneath it, such as downloads loading.
  const downloads = useBrowserDownloadsStore((state) =>
    open && scope === "downloads" ? state.entries : none,
  );
  const bookmarks = useWorkspaceStore((state) =>
    open && scope === "bookmarks" ? state.bookmarks : none,
  );
  const [results, setResults] = useState<ScopedSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const trimmed = query.trim();

  useEffect(() => {
    setResults([]);
    setLoading(false);
  }, [scope]);

  useEffect(() => {
    if (scope !== "agents" || !user?.id) return;
    const agentStore = usePersonalAgentsStore.getState();
    if (agentStore.accountId !== user.id || !agentStore.agents.length)
      void agentStore.load(user.id);
    if (!useMistyStore.getState().conversations.length)
      void useMistyStore.getState().loadConversations();
  }, [scope, user?.id]);

  useEffect(() => {
    if (scope !== "agents") return;
    setResults(searchAgents(trimmed, agents, conversations));
    setLoading(false);
  }, [scope, trimmed, agents, conversations]);

  useEffect(() => {
    const source = sources[scope];
    if (!open || !source) return;
    let cancelled = false;
    setLoading(true);
    // Lists for an empty query (actions, recent items) show at once.
    const timer = window.setTimeout(
      async () => {
        const next = await Promise.resolve()
          .then(() => source(trimmed, spaces))
          .catch(() => []);
        if (cancelled) return;
        setResults(next);
        setLoading(false);
      },
      trimmed ? debounceMs : 0,
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, scope, trimmed, spaces, downloads, bookmarks]);

  useEffect(() => {
    if (scope !== "files") return;
    if (!trimmed) {
      setResults([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      void kuraInstalled()
        .catch(() => false)
        .then((installed) => {
          if (cancelled) return;
          setResults([kuraSearchResult(trimmed, installed)]);
          setLoading(false);
        });
    }, debounceMs);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [scope, trimmed]);

  return { results, loading };
}
