import { useEffect, useState } from "react";
import { useAuth } from "@/features/auth";
import { useSpacesStore } from "@/features/spaces/core";
import { usePersonalAgentsStore } from "@/features/agents/personalAgentsStore";
import { useMistyStore } from "@/features/misty/useMistyStore";
import {
  semanticQueryMinimumCharacters,
  semanticSearchDebounceMs,
} from "@/features/files/workspace/explorer/utils/globalSearch";
import type { SearchScope } from "./searchCommands";
import {
  fileResults,
  searchAgents,
  searchFileContents,
  searchIndexedFiles,
  searchSpaces,
  type ScopedSearchResult,
} from "./scopedSearchSources";
export type { ScopedSearchResult } from "./scopedSearchSources";

const debounceMs = 180;

/** Browser scope never searches while typing. Files show name matches first,
 * then fold in content matches once the slower semantic search settles.
 * Responses for stale queries are dropped. */
export function useScopedSearch(scope: SearchScope, query: string) {
  const { user } = useAuth();
  const spaces = useSpacesStore((state) => state.spaces);
  const agents = usePersonalAgentsStore((state) => state.agents);
  const conversations = useMistyStore((state) => state.conversations);
  const [results, setResults] = useState<ScopedSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const trimmed = query.trim();

  useEffect(() => setResults([]), [scope]);

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
    if (scope === "agents") return;
    if (scope === "browser" || (scope === "files" && !trimmed)) {
      setResults([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const timers: number[] = [];
    setLoading(true);
    if (scope === "spaces") {
      timers.push(
        window.setTimeout(async () => {
          const next = await searchSpaces(trimmed, spaces);
          if (cancelled) return;
          setResults(next);
          setLoading(false);
        }, debounceMs),
      );
    } else {
      const indexed = new Promise<Awaited<ReturnType<typeof searchIndexedFiles>>>((resolve) =>
        timers.push(window.setTimeout(() => resolve(searchIndexedFiles(trimmed)), debounceMs)),
      );
      const semantic = trimmed.length >= semanticQueryMinimumCharacters;
      void indexed.then((hits) => {
        if (cancelled) return;
        setResults(fileResults(hits));
        if (!semantic) setLoading(false);
      });
      if (semantic)
        timers.push(
          window.setTimeout(async () => {
            const merged = await searchFileContents(trimmed, await indexed);
            if (cancelled) return;
            setResults(fileResults(merged));
            setLoading(false);
          }, semanticSearchDebounceMs),
        );
    }
    return () => {
      cancelled = true;
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [scope, trimmed, spaces]);

  return { results, loading };
}
