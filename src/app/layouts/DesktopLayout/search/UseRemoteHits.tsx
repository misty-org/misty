import { FileCode, History, Plug } from "lucide-react";
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
} from "@/features/agents";
import { searchSpaceText, type SpaceSearchHit } from "@/features/spaces";
import { useSettingsStore } from "@/features/settings";
import { selectSearchSources } from "./search_sources";
import type { AgentProfile } from "@/shared/schemas";
import { agentChatRoute } from "../space_navigation";
import { excerpt, fieldScore, matchScore, type Part } from "./search_rank";
import type { SearchHit } from "./search_types";
import { icon, spaceGroups, spaceIcons } from "./SearchIcons";

const plain = (text: string): Part[] => (text ? [{ text, marked: false }] : []);

export function useRemoteHits({
  spaceId,
  words,
  asking,
  agents,
  openRoute,
}: {
  spaceId: string;
  words: string;
  asking: boolean;
  agents: AgentProfile[];
  openRoute(route: string): void;
}) {
  const [remote, setRemote] = useState<{ key: string; hits: SearchHit[]; waiting: number }>({
    key: "",
    hits: [],
    waiting: 0,
  });
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
          spaceHit(hit, Math.max(fieldScore(words, hit.title, hit.text), 6 - index * 0.2)),
        ),
      );
    }
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
              open: () => openAgentsHub("connections"),
            },
          ];
        });
      });
    if (include.sessions)
      sources.push(async () => {
        const { hits } = await searchEngineSessions(words);
        return hits.slice(0, 12).flatMap((hit) => {
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
    // `agents` is read when the words change; a new search follows them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteKey, openRoute]);

  return { remote, remoteKey };
}
