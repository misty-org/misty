import {
  Armchair,
  CalendarDays,
  CalendarPlus,
  FileText,
  GraduationCap,
  KanbanSquare,
  Library,
  ListPlus,
  MessagesSquare,
  NotebookPen,
  FlaskConical,
  Galaxy,
  Plus,
  Settings,
  SquarePen,
  TerminalSquare,
  Waypoints,
  type LucideIcon,
} from "lucide-react";
import { useMemo } from "react";
import { useAuth } from "@/features/account";
import {
  AgentAvatar,
  askInNewChat,
  messageSearchText,
  requestChatFind,
  tutorChatIds,
  useLessonStore,
  useMistyStore,
  usePersonalAgentsStore,
  useTutorStore,
} from "@/features/agents";
import { useCommands } from "@/features/commands";
import { openSettings, searchSettings } from "@/features/settings";
import {
  createSpaceEvent,
  createSpaceNote,
  createSpaceTask,
  kindIcon,
  useSpaceGallery,
  useWindowSpace,
} from "@/features/spaces";
import { cn, itemToneClass } from "@/shared/ui";
import { agentChatRoute } from "../spaceNavigation";
import { excerpt, fieldScore, matchScore, rank } from "./searchRank";
import { useSearchUses } from "./searchStore";
import { icon } from "./SearchIcons";
import { useRemoteHits } from "./useRemoteHits";
import type { SearchQuery } from "./searchQuery";
import type { SearchHit, SearchKind } from "./searchTypes";

/** The pages search goes to; the Space's need a Space. */
const pages: { label: string; icon: LucideIcon; route(base: string): string; space?: boolean }[] = [
  { label: "Space", icon: Galaxy, route: (base) => base, space: true },
  { label: "Studio", icon: Armchair, route: () => "/agents?view=studio" },
  { label: "Lab", icon: FlaskConical, route: () => "/agents?view=lab" },
  { label: "Integrations", icon: Waypoints, route: () => "/agents?view=integrations" },
  { label: "Chat", icon: MessagesSquare, route: (base) => `${base}/chat`, space: true },
  { label: "Docs", icon: FileText, route: (base) => `${base}/notes`, space: true },
  { label: "Planner", icon: KanbanSquare, route: (base) => `${base}/planner`, space: true },
  { label: "Calendar", icon: CalendarDays, route: (base) => `${base}/calendar`, space: true },
  { label: "Library", icon: Library, route: (base) => `${base}/library`, space: true },
];

/** How the order weighs a kind's match against the others'. */
const weights: Record<string, number> = {
  Actions: 3,
  "Go to": 1.3,
  Chats: 1.2,
  Agents: 1.1,
  Notes: 1.1,
  Tasks: 1.1,
  Events: 1,
  Space: 1,
  Files: 0.9,
  Settings: 0.9,
  Commands: 0.9,
  Notebooks: 1,
  "In notebooks": 0.8,
  Messages: 0.8,
  "Engine history": 0.7,
  Apps: 0.7,
};

interface SearchContext {
  query: SearchQuery;
  kind: SearchKind;
  /** Opens a page of the window in the focused pane. */
  openRoute(route: string): void;
  onNewChat(): void;
}

interface SearchResults {
  /** Ranked, best first. */
  hits: SearchHit[];
  /** Sources still answering, so the list can show where more is coming. */
  waiting: boolean;
}

/**
 * Everything ⌘K search can find, for what was typed: the person's chats (by their text too),
 * agents, the Space's notes, messages, tasks, events and files, the notebooks and lessons,
 * apps to connect, settings, commands and pages. What lives on this computer is matched here;
 * Space content is searched by the server; engines' own histories by native code.
 */
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
  const tutorJobs = useTutorStore((state) => state.jobs);
  const notebooks = useTutorStore((state) => state.notebooks);
  const gallery = useSpaceGallery(spaceId, user?.id ?? "", false);
  const commands = useCommands();
  const uses = useSearchUses((state) => state.uses);

  const agentOf = useMemo(
    () => (agentId?: string) =>
      agents.find((agent) => agent.id === agentId) ??
      (agentId ? undefined : agents.find((agent) => agent.system_managed)),
    [agents],
  );
  const defaultAgent = useMemo(
    () =>
      agents.find((agent) => agent.engine && agent.enabled && !agent.system_managed) ??
      agents.find((agent) => agent.system_managed) ??
      agents[0],
    [agents],
  );

  // What lives here: matched on every keystroke.
  const local = useMemo(() => {
    const hits: SearchHit[] = [];
    const typed = words.length > 0;
    const tutorMade = tutorChatIds(tutorJobs, notebooks);

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
      if (!chat.messages.length || lessons[chat.id] || tutorMade.has(chat.id)) continue;
      const agent = agentOf(chat.agentId);
      if (!agent) continue;
      const title = chat.title || "New conversation";
      const route = agentChatRoute(agent.id, chat.id);
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
          open: () => openRoute(route),
        });
        continue;
      }
      const head = matchScore(title, words);
      // The best message it has, for the words around the match and the chat's find.
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
          openRoute(route);
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

    for (const notebook of Object.values(notebooks)) {
      const match = typed ? matchScore(notebook.title, words) : 0;
      if (typed && !match) continue;
      hits.push({
        id: `notebook:${notebook.id}`,
        kind: "learn",
        group: "Notebooks",
        title: notebook.title || "Untitled notebook",
        detail: "Notebook",
        icon: notebook.emoji ? <span aria-hidden>{notebook.emoji}</span> : icon(NotebookPen),
        updatedAt: notebook.updatedAt,
        match,
        open: () => openRoute(`/agents?view=lab&item=notebook:${encodeURIComponent(notebook.id)}`),
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
        icon: <Icon className={cn("size-4", itemToneClass(tone))} aria-hidden />,
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
    tutorJobs,
    notebooks,
    gallery.items,
    agents,
    agentOf,
    openRoute,
  ]);

  // What other places answer: the server, native code, the notebooks' index.
  const asking = Boolean(query.ask);
  const { remote, remoteKey } = useRemoteHits({
    spaceId,
    words,
    asking,
    notebooks,
    agents,
    openRoute,
  });

  // What the typed text asks to do, above what it finds.
  const actions = useMemo(() => {
    const hits: SearchHit[] = [];
    const { ask, create } = query;
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
    const makers = {
      note: { icon: SquarePen, label: "doc", make: createSpaceNote },
      task: { icon: ListPlus, label: "task", make: createSpaceTask },
      event: { icon: CalendarPlus, label: "event", make: createSpaceEvent },
    } as const;
    const make = (what: keyof typeof makers, title: string): SearchHit => ({
      id: `action:new-${what}`,
      kind: "space",
      group: "Actions",
      title: `New ${makers[what].label}: ${title}`,
      icon: icon(makers[what].icon),
      match: create ? 10 : 0.5,
      open: async () => openRoute(await makers[what].make(spaceId, title)),
    });
    if (create && spaceId) {
      hits.push(make(create.what, create.title));
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
    if (spaceId)
      for (const what of ["note", "task", "event"] as const) hits.push(make(what, words));
    return hits;
  }, [query, words, agents, defaultAgent, spaceId, openRoute, context.onNewChat]);

  const hits = useMemo(() => {
    const now = Date.now();
    const found = [...local, ...(remote.key === remoteKey ? remote.hits : [])];
    // The same thing from two sources (a note by title and by text) shows once, at its best.
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
        weight: weights[hit.group] ?? 1,
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
    // Something the text asks for outright goes first; the rest of the actions go last.
    return [
      ...doing.filter((hit) => hit.match >= 10),
      ...ranked,
      ...doing.filter((hit) => hit.match < 10),
    ];
  }, [local, remote, remoteKey, kind, uses, words, actions]);

  return {
    hits,
    waiting:
      (!asking && remote.key !== remoteKey && words.length >= 2) ||
      remote.waiting > 0 ||
      gallery.loading,
  };
}
