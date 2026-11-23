import {
  Armchair,
  GraduationCap,
  MessagesSquare,
  Galaxy,
  Plus,
  Settings,
  TerminalSquare,
  type LucideIcon,
} from "lucide-react";
import { useMemo } from "react";
import { useAuth } from "@/features/account";
import {
  AgentAvatar,
  askInNewChat,
  messageSearchText,
  requestChatFind,
  useLessonStore,
  useMistyStore,
  defaultAgentOf,
  usePersonalAgentsStore,
} from "@/features/agents";
import { useCommands } from "@/features/commands";
import { openSettings, searchSettings } from "@/features/settings";
import { kindIcon, useSpaceGallery, useWindowSpace } from "@/features/spaces";
import { itemToneClass, spaceIcons } from "@misty/ui";
import { agentChatRoute } from "../space_navigation";
import { excerpt, fieldScore, matchScore, rank } from "./search_rank";
import { useSearchUses } from "./search_store";
import { icon } from "./SearchIcons";
import { useRemoteHits } from "./UseRemoteHits";
import type { SearchQuery } from "./search_query";
import type { SearchHit, SearchKind } from "./search_types";

const pages: { label: string; icon: LucideIcon; route(base: string): string; space?: boolean }[] = [
  { label: "Space", icon: Galaxy, route: (base) => base, space: true },
  { label: "Studio", icon: Armchair, route: () => "/agents?view=studio" },
  { label: "Chat", icon: MessagesSquare, route: (base) => `${base}/chat`, space: true },
  { label: "Files", icon: spaceIcons.files, route: () => "/agents?view=files" },
];

const weights: Record<string, number> = {
  Actions: 3,
  "Go to": 1.3,
  Chats: 1.2,
  Agents: 1.1,
  Space: 1,
  Files: 0.9,
  Settings: 0.9,
  Commands: 0.9,
  Notebooks: 1,
  Messages: 0.8,
  "Engine history": 0.7,
  Apps: 0.7,
};

interface SearchContext {
  query: SearchQuery;
  kind: SearchKind;
  here?: SearchKind;
  openRoute(route: string): void;
  onNewChat(): void;
}

interface SearchResults {
  hits: SearchHit[];
  waiting: boolean;
}

export function useSearchHits(context: SearchContext): SearchResults {
  const { query, kind, openRoute } = context;
  const words = query.text;
  const { user } = useAuth();
  const space = useWindowSpace();
  const spaceId = space?.id ?? "";
  const base = spaceId ? `/spaces/${encodeURIComponent(spaceId)}` : "";
  const agents = usePersonalAgentsStore((state) => state.agents);
  const conversations = useMistyStore((state) => state.conversations);
  const lessons = useLessonStore((state) => state.lessons);
  const gallery = useSpaceGallery(spaceId, user?.id ?? "");
  const commands = useCommands();
  const uses = useSearchUses((state) => state.uses);

  const agentOf = useMemo(
    () => (agentId?: string) =>
      agents.find((agent) => agent.id === agentId) ??
      (agentId ? undefined : agents.find((agent) => agent.system_managed)),
    [agents],
  );
  const defaultAgent = useMemo(() => defaultAgentOf(agents) ?? agents[0], [agents]);

  const local = useMemo(() => {
    const hits: SearchHit[] = [];
    const typed = words.length > 0;

    for (const page of pages) {
      if (page.space && !base) continue;
      const match = typed ? matchScore(page.label, words) : 0;
      if (!match) continue;
      hits.push({
        id: `page:${page.label}`,
        kind: "commands",
        group: "Go to",
        title: page.label,
        icon: icon(page.icon),
        match,
        open: () => openRoute(page.route(base)),
      });
    }

    for (const command of commands) {
      if (command.available && !command.available()) continue;
      const title = command.title();
      const match = typed
        ? fieldScore(words, title, ...(command.keywords?.() ?? []))
        : kind === "commands"
          ? 1
          : 0;
      if (!match) continue;
      hits.push({
        id: `command:${command.id}`,
        kind: "commands",
        group: "Commands",
        title,
        icon: icon(TerminalSquare),
        match,
        shortcutId: command.shortcutId,
        open: () => command.run(),
      });
    }

    for (const chat of conversations) {
      if (!chat.messages.length || chat.place) continue;
      if (lessons[chat.id]) continue;
      const agent = agentOf(chat.agentId);
      if (!agent) continue;
      const title = chat.title || "New conversation";
      const go = () => openRoute(agentChatRoute(agent.id, chat.id));
      if (!typed) {
        hits.push({
          id: `chat:${chat.id}`,
          kind: "chats",
          group: "Chats",
          title,
          detail: agent.name,
          icon: <AgentAvatar agent={agent} compact />,
          updatedAt: chat.updatedAt,
          match: 0,
          open: go,
        });
        continue;
      }
      const head = matchScore(title, words);
      let body = 0;
      let said = "";
      for (const message of chat.messages) {
        const text = messageSearchText(message);
        const score = matchScore(text, words);
        if (score > body) {
          body = score;
          said = text;
        }
      }
      const match = Math.max(head, body * 0.7);
      if (!match) continue;
      const inside = body * 0.7 > head;
      hits.push({
        id: `chat:${chat.id}`,
        kind: "chats",
        group: "Chats",
        title,
        detail: agent.name,
        excerpt: inside ? excerpt(said, words) : undefined,
        icon: <AgentAvatar agent={agent} compact />,
        updatedAt: chat.updatedAt,
        match,
        open: () => {
          if (inside) requestChatFind(chat.id, words);
          go();
        },
      });
    }

    if (typed)
      for (const agent of agents) {
        if (!agent.enabled && !agent.system_managed) continue;
        const match = fieldScore(words, agent.name, agent.description ?? "");
        if (!match) continue;
        hits.push({
          id: `agent:${agent.id}`,
          kind: "chats",
          group: "Agents",
          title: `Chat with ${agent.name}`,
          icon: <AgentAvatar agent={agent} compact />,
          match,
          open: () => openRoute(agentChatRoute(agent.id, undefined, true)),
        });
      }

    for (const lesson of Object.values(lessons)) {
      const chat = conversations.find((c) => c.id === lesson.id);
      const agent = agentOf(lesson.agentId ?? chat?.agentId);
      if (!chat || !agent) continue;
      const match = typed ? fieldScore(words, lesson.title, lesson.goal) : 0;
      if (typed && !match) continue;
      hits.push({
        id: `lesson:${lesson.id}`,
        kind: "learn",
        group: "Lessons",
        title: lesson.title,
        detail: "Lesson",
        icon: icon(GraduationCap),
        updatedAt: lesson.updatedAt,
        match,
        open: () => openRoute(agentChatRoute(agent.id, lesson.id)),
      });
    }

    for (const item of gallery.items) {
      const match = typed ? fieldScore(words, item.title, item.excerpt) : 0;
      if (typed && !match) continue;
      const { Icon, tone, label } = kindIcon[item.kind];
      hits.push({
        id: `space:${item.href}`,
        kind: "space",
        group: "Space",
        title: item.title,
        detail: label,
        excerpt:
          typed && item.excerpt && !matchScore(item.title, words)
            ? excerpt(item.excerpt, words)
            : undefined,
        icon: <Icon className={itemToneClass(tone)} aria-hidden />,
        updatedAt: item.updatedAt,
        match,
        open: () => openRoute(item.href),
      });
    }

    if (typed)
      for (const setting of searchSettings(words)) {
        hits.push({
          id: `setting:${setting.key}`,
          kind: "settings",
          group: "Settings",
          title: setting.label,
          detail: "Settings",
          icon: icon(Settings),
          match: matchScore(setting.label, words) || 2,
          open: () => openSettings(setting.page, setting.focus || undefined),
        });
      }
    return hits;
  }, [
    words,
    kind,
    base,
    commands,
    conversations,
    lessons,
    gallery.items,
    agents,
    agentOf,
    openRoute,
  ]);

  const asking = Boolean(query.ask);
  const { remote, remoteKey } = useRemoteHits({
    spaceId,
    words,
    asking,
    agents,
    openRoute,
  });

  const actions = useMemo(() => {
    const hits: SearchHit[] = [];
    const { ask } = query;
    const askAgent = ask ? agents.find((agent) => agent.id === ask.agentId) : undefined;
    const send = (agentId: string, prompt: string) => async () => {
      const id = await askInNewChat(agentId, prompt);
      openRoute(agentChatRoute(agentId, id));
    };
    if (askAgent) {
      hits.push({
        id: "action:ask-named",
        kind: "chats",
        group: "Actions",
        title: ask!.prompt ? `Ask ${askAgent.name}: ${ask!.prompt}` : `Chat with ${askAgent.name}`,
        icon: <AgentAvatar agent={askAgent} compact />,
        match: 10,
        open: ask!.prompt
          ? send(askAgent.id, ask!.prompt)
          : () => openRoute(agentChatRoute(askAgent.id, undefined, true)),
      });
      return hits;
    }
    if (!words) {
      hits.push({
        id: "action:new-chat",
        kind: "chats",
        group: "Actions",
        title: "New chat",
        icon: icon(Plus),
        match: 1,
        open: context.onNewChat,
      });
      return hits;
    }
    if (query.kind) return hits;
    if (defaultAgent)
      hits.push({
        id: "action:ask",
        kind: "chats",
        group: "Actions",
        title: `Ask ${defaultAgent.name}: ${words}`,
        icon: <AgentAvatar agent={defaultAgent} compact />,
        match: 0.6,
        open: send(defaultAgent.id, words),
      });
    return hits;
  }, [query, words, agents, defaultAgent, openRoute, context.onNewChat]);

  const hits = useMemo(() => {
    const now = Date.now();
    const found = [...local, ...(remote.key === remoteKey ? remote.hits : [])];
    const best = new Map<string, SearchHit>();
    for (const hit of found) {
      const known = best.get(hit.id);
      if (
        !known ||
        hit.match > known.match ||
        (hit.excerpt && !known.excerpt && hit.match === known.match)
      )
        best.set(hit.id, hit);
    }
    const shown = [...best.values()].filter((hit) => kind === "all" || hit.kind === kind);
    const score = (hit: SearchHit) => {
      const use = uses[hit.id];
      if (!words)
        return Math.max(Date.parse(hit.updatedAt ?? "") || 0, use?.last ?? 0) + (use?.count ?? 0);
      return rank({
        match: hit.match,
        weight: (weights[hit.group] ?? 1) * (context.here && hit.kind === context.here ? 1.3 : 1),
        updatedAt: hit.updatedAt,
        uses: use?.count,
        now,
      });
    };
    const ranked = shown
      .map((hit) => ({ hit, score: score(hit) }))
      .sort((a, b) => b.score - a.score)
      .map(({ hit }) => hit);
    const doing = actions.filter((hit) => kind === "all" || hit.kind === kind || hit.match >= 10);
    return [
      ...doing.filter((hit) => hit.match >= 10),
      ...ranked,
      ...doing.filter((hit) => hit.match < 10),
    ];
  }, [local, remote, remoteKey, kind, uses, words, actions, context.here]);

  return {
    hits,
    waiting:
      (!asking && remote.key !== remoteKey && words.length >= 2) ||
      remote.waiting > 0 ||
      gallery.loading,
  };
}
