import { FileCode, FileText, History, Waypoints } from "lucide-react";
import { useEffect, useState } from "react";
import {
  directAppsApi,
  openFolderFile,
  resumeInNewChat,
  searchEngineSessions,
  searchFolderFiles,
  searchNotebooks,
} from "@/features/agents";
import { searchSpaceText, spaceEvents, spaceTasks, type SpaceSearchHit } from "@/features/spaces";
import type { AgentProfile } from "@/shared/schemas";
import { agentChatRoute } from "../spaceNavigation";
import { excerpt, fieldScore, matchScore, type Part } from "./searchRank";
import type { SearchHit } from "./searchTypes";
import { icon, spaceGroups, spaceIcons } from "./SearchIcons";

const plain = (text: string): Part[] => (text ? [{ text, marked: false }] : []);

/**
 * What other places answer a search: the Space's server, the linked folder's files, the
 * notebooks' index, apps that take a direct sign-in, and the engines' own history. Each answers
 * on its own; `waiting` counts the ones still out.
 */
export function useRemoteHits({
  spaceId,
  words,
  asking,
  notebooks,
  agents,
  openRoute,
}: {
  spaceId: string;
  words: string;
  asking: boolean;
  notebooks: Record<string, { id: string; title: string }>;
  agents: AgentProfile[];
  openRoute(route: string): void;
}) {
  const [remote, setRemote] = useState<{ key: string; hits: SearchHit[]; waiting: number }>({
    key: "",
    hits: [],
    waiting: 0,
  });
  // What follows `@agent` is a prompt, and prompts never leave this computer except to the
  // agent's own engine: only a plain search asks the server and the other sources.
  const remoteKey = `${spaceId}\n${asking ? "" : words}`;
  useEffect(() => {
    if (asking || words.length < 2) {
      setRemote({ key: remoteKey, hits: [], waiting: 0 });
      return;
    }
    const controller = new AbortController();
    const { signal } = controller;
    const sources: (() => Promise<SearchHit[]>)[] = [];
    const spaceHit = (hit: SpaceSearchHit, match: number): SearchHit => ({
      id: `${hit.kind}:${hit.id}`,
      kind: "space",
      group: spaceGroups[hit.kind],
      title: hit.title,
      detail: hit.kind === "message" ? "Message" : undefined,
      excerpt: hit.text ? excerpt(hit.text, words) : undefined,
      icon: icon(spaceIcons[hit.kind]),
      updatedAt: hit.updatedAt,
      match,
      open: () => openRoute(hit.href),
    });
    if (spaceId) {
      sources.push(async () =>
        (await searchSpaceText(spaceId, words, signal)).map((hit, index) =>
          // The server ranks these; its order is kept, a little under a title match.
          spaceHit(hit, Math.max(fieldScore(words, hit.title, hit.text), 6 - index * 0.2)),
        ),
      );
      sources.push(async () =>
        [...(await spaceTasks(spaceId)), ...(await spaceEvents(spaceId))].flatMap((hit) => {
          const match = fieldScore(words, hit.title, hit.text);
          return match ? [spaceHit(hit, match)] : [];
        }),
      );
    }
    if (Object.keys(notebooks).length)
      sources.push(async () => {
        const { hits } = await searchNotebooks(words, signal);
        return hits.flatMap((hit) => {
          const notebook = notebooks[hit.notebookId];
          if (!notebook) return [];
          const match = Math.max(matchScore(hit.text, words), hit.score > 0.3 ? 3 : 0);
          if (!match) return [];
          return [
            {
              id: `passage:${hit.notebookId}:${hit.itemId}`,
              kind: "learn" as const,
              group: "In notebooks",
              title: hit.title || notebook.title,
              detail: notebook.title,
              excerpt: excerpt(hit.text, words),
              icon: icon(FileText),
              match,
              open: () =>
                openRoute(`/agents?view=lab&item=notebook:${encodeURIComponent(notebook.id)}`),
            },
          ];
        });
      });
    if (spaceId)
      sources.push(async () =>
        (await searchFolderFiles(spaceId, (name, rel) => fieldScore(words, name, rel))).map(
          (file) => ({
            id: `file:${file.path}`,
            kind: "space" as const,
            group: "Files",
            title: file.name,
            excerpt: plain(file.rel),
            icon: icon(FileCode),
            match: file.match,
            open: () => {
              openFolderFile(file.path);
              openRoute("/agents");
            },
          }),
        ),
      );
    sources.push(async () => {
      const { apps } = await directAppsApi.catalog(words, 0);
      return apps.slice(0, 6).flatMap((app) => {
        const match = fieldScore(words, app.name, app.description);
        if (!match) return [];
        return [
          {
            id: `app:${app.url}`,
            kind: "apps" as const,
            group: "Apps",
            title: `Connect ${app.name}`,
            detail: app.description ? undefined : "App",
            excerpt: app.description ? plain(app.description) : undefined,
            icon: icon(Waypoints),
            match,
            open: () => openRoute(`/agents?view=integrations&find=${encodeURIComponent(app.name)}`),
          },
        ];
      });
    });
    sources.push(async () => {
      const { hits } = await searchEngineSessions(words);
      return hits.slice(0, 12).flatMap((hit) => {
        const agent =
          agents.find((item) => item.engine === hit.engine && item.enabled) ??
          agents.find((item) => item.engine === hit.engine);
        if (!agent) return [];
        const title = hit.customTitle || hit.title || "Session";
        const updatedAt = hit.updatedAt ? new Date(hit.updatedAt).toISOString() : undefined;
        return [
          {
            id: `engine:${hit.engine}:${hit.sessionId}`,
            kind: "chats" as const,
            group: "Engine history",
            title,
            detail: agent.name,
            excerpt: hit.snippet.length ? hit.snippet : undefined,
            icon: icon(History),
            updatedAt,
            match: Math.max(matchScore(title, words), 3),
            open: async () => {
              const id = await resumeInNewChat(agent.id, { ...hit, title });
              openRoute(agentChatRoute(agent.id, id));
            },
          },
        ];
      });
    });

    setRemote((current) => ({
      key: remoteKey,
      hits: current.key === remoteKey ? current.hits : [],
      waiting: sources.length,
    }));
    // Typing quickly asks once, for the words it stops at.
    const timer = window.setTimeout(() => {
      for (const source of sources)
        void source()
          .then((hits) => {
            if (signal.aborted) return;
            setRemote((current) =>
              current.key === remoteKey
                ? { ...current, hits: [...current.hits, ...hits], waiting: current.waiting - 1 }
                : current,
            );
          })
          .catch(() => {
            if (signal.aborted) return;
            setRemote((current) =>
              current.key === remoteKey ? { ...current, waiting: current.waiting - 1 } : current,
            );
          });
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // `notebooks` and `agents` are read when the words change; a new search follows them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteKey, openRoute]);

  return { remote, remoteKey };
}
