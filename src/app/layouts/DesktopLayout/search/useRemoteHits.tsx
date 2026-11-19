import { FileCode, FileText, History, Plug } from "lucide-react";
import { useEffect, useState } from "react";
import {
  defaultEngineAgent,
  directAppsApi,
  folderName,
  openAgentsHub,
  openFolderFile,
  resumeInNewChat,
  searchEngineSessions,
  searchFolderFiles,
  searchNotebooks,
  notebookRoute,
} from "@/features/agents";
import { searchSpaceText, spaceEvents, spaceTasks, type SpaceSearchHit } from "@/features/spaces";
import { useSettingsStore } from "@/features/settings";
import { selectSearchSources } from "./searchSources";
import type { AgentProfile } from "@/shared/schemas";
import { agentChatRoute } from "../spaceNavigation";
import { excerpt, fieldScore, matchScore, type Part } from "./searchRank";
import type { SearchHit } from "./searchTypes";
import { icon, spaceGroups, spaceIcons } from "./SearchIcons";

const plain = (text: string): Part[] => (text ? [{ text, marked: false }] : []);

/**
 * What other places answer a search: the Space's server, the files in the person's project
 * folders, the notebooks' index, apps that take a direct sign-in, and the engines' own history.
 * Each answers on its own; `waiting` counts the ones still out.
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
  // Which sources the person searches is part of the key, so a change in Settings asks again.
  const searchSettings = useSettingsStore((state) => state.settings?.document.search);
  const include = selectSearchSources({ search: searchSettings });
  const remoteKey = `${spaceId}\n${include.key}\n${asking ? "" : words}`;
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
              open: () => openRoute(notebookRoute(notebook)),
            },
          ];
        });
      });
    if (include.files)
      sources.push(async () =>
        (await searchFolderFiles((name, rel) => fieldScore(words, name, rel))).map((file) => ({
          id: `file:${file.path}`,
          kind: "space" as const,
          group: "Files",
          title: file.name,
          excerpt: plain(file.rel),
          icon: icon(FileCode),
          match: file.match,
          open: () => {
            // The Code page keeps the file when it's up; otherwise a chat's files panel shows it.
            openRoute(openFolderFile(file.path));
          },
        })),
      );
    if (include.apps)
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
              icon: icon(Plug),
              match,
              open: () => openAgentsHub("apps"),
            },
          ];
        });
      });
    if (include.sessions)
      sources.push(async () => {
        const { hits } = await searchEngineSessions(words);
        return hits.slice(0, 12).flatMap((hit) => {
          // A chat from any folder is listed when an agent on its engine can continue it.
          if (!agents.some((item) => item.engine === hit.engine)) return [];
          const title = hit.customTitle || hit.title || "Session";
          const updatedAt = hit.updatedAt ? new Date(hit.updatedAt).toISOString() : undefined;
          return [
            {
              id: `engine:${hit.engine}:${hit.sessionId}`,
              kind: "chats" as const,
              group: "Engine history",
              title,
              detail: folderName(hit.workspacePath),
              excerpt: hit.snippet.length ? hit.snippet : undefined,
              icon: icon(History),
              updatedAt,
              match: Math.max(matchScore(title, words), 3),
              open: async () => {
                // The engine's default agent continues it in a new chat: in the session's folder
                // when that is one of the person's projects, else in the chat's scratch folder.
                const agentId = defaultEngineAgent(hit.engine);
                if (!agentId) return;
                const id = await resumeInNewChat(agentId, { ...hit, title });
                openRoute(agentChatRoute(agentId, id));
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
