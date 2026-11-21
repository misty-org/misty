import { useVirtualizer } from "@tanstack/react-virtual";
import { RotateCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useCachedResource } from "@/api/cache/cached-resource";
import { EngineMark } from "@/features/engine-config/EngineMark";
import { useNow } from "@/shared/hooks/useNow";
import { uiPx } from "@misty/ui";
import type { AgentProfile } from "@/shared/schemas";
import {
  Button,
  EmptyState,
  ErrorState,
  formatRowTime,
  IconButton,
  SearchField,
  Skeleton,
  SkeletonList,
  Text,
  TreeRow,
} from "@misty/ui";
import type { GlobalAiConversation } from "../../conversations/state/conversationTypes";
import { useMistyStore } from "../../conversations/state/useMistyStore";
import { resumeInNewChat } from "../../conversations/startChat";
import {
  listEngineSessions,
  readChatSession,
  rescanEngineSessions,
  sessionsByFolder,
  type EngineSession,
} from "../../conversations/view/engine/engineHistory";
import { defaultEngineAgent } from "../../engines/defaultEngine";
import { folderName, mistyEngine, useEnginesList } from "../../engines/enginesApi";
import { openAgentsHub } from "../../hub/agentsHubStore";
import { AgentAvatar } from "../../personal/AgentAvatar";
import { usePersonalAgentsStore } from "../../personal/personalAgentsStore";
import { useChatFolders, useProjectChats } from "../../shared-folders/chatFolder";
import { useCodePageLayout } from "../codePageStore";
import { chatAgentOf, openCodeChat } from "./CodeChatColumn";
import { NewSessionControl } from "./NewSessionControl";

/** A row of the list: a Misty chat, or a session in an engine's own history that no chat holds. */
type Entry =
  | {
      kind: "chat";
      key: string;
      workspacePath: string;
      updatedAt: number;
      title: string;
      chat: GlobalAiConversation;
      agent?: AgentProfile;
    }
  | {
      kind: "session";
      key: string;
      workspacePath: string;
      updatedAt: number;
      title: string;
      session: EngineSession;
    };

/** One line of the list, flattened so it can be virtual. */
type Line =
  | { kind: "folder"; key: string; path: string; count: number; open: boolean }
  | { kind: "entry"; key: string; entry: Entry }
  | { kind: "notice"; key: string; entry: Entry; text: string; addAgent: boolean }
  | { kind: "loading"; key: string };

const sessionKey = (session: { engine: string; sessionId: string }) =>
  `${session.engine}:${session.sessionId}`;

const sessionTitle = (session: EngineSession) =>
  session.customTitle?.trim() || session.title.trim() || "Untitled session";

const groupName = (path: string) => folderName(path);

/** The sessions whose turns a chat shows, kept per message list so a streaming answer only
 * reads its own chat again. */
const tagsByMessages = new WeakMap<GlobalAiConversation["messages"], string[]>();
function importedTags(chat: GlobalAiConversation): string[] {
  let tags = tagsByMessages.get(chat.messages);
  if (!tags) {
    tags = [...new Set(chat.messages.flatMap((message) => message.importedFrom ?? []))];
    tagsByMessages.set(chat.messages, tags);
  }
  return tags;
}

/** Reads `ids` a few at a time, so a long list of chats doesn't flood native code at once. */
async function eachFew(ids: readonly string[], read: (id: string) => Promise<void>) {
  const queue = [...ids];
  const worker = async () => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) await read(id);
  };
  await Promise.all(Array.from({ length: Math.min(6, queue.length) }, worker));
}

/** A row's time, kept current. */
function RowTime({ at }: { at: number }) {
  const now = useNow();
  if (!at) return null;
  return (
    <Text size="meta" tone="muted">
      {formatRowTime(at, now)}
    </Text>
  );
}

/** What a row starts with: the chat's agent's small mark, or the engine's for its own session. */
function entryMark(entry: Entry): ReactNode {
  if (entry.kind === "session") return <EngineMark engine={entry.session.engine} />;
  return entry.agent ? (
    <AgentAvatar agent={entry.agent} compact />
  ) : (
    <EngineMark engine={mistyEngine} />
  );
}

/**
 * The Code page's sessions, grouped by the project they work in: every chat that works in a
 * project, whatever its agent and engine (chats in their own scratch folder are the sidebar's),
 * and every session in an engine's own history that no chat holds yet. A chat opens in the column beside the
 * editor; a session continues in a new chat with its engine's default agent, then opens there.
 */
export function SessionsSidebar() {
  const conversations = useMistyStore((state) => state.conversations);
  const conversationsLoading = useMistyStore((state) => state.conversationsLoading);
  const conversationsError = useMistyStore((state) => state.conversationsError);
  const projectChats = useProjectChats();
  const agents = usePersonalAgentsStore((state) => state.agents);
  const openChat = useCodePageLayout((state) => state.value.chat);
  const lastProject = useCodePageLayout((state) => state.value.lastProject);
  const engines = useEnginesList().data;
  // The engines' own history: the last read paints at once, and opening reads their files again.
  const history = useCachedResource<EngineSession[]>("agents/engine-history", listEngineSessions);
  const setHistory = history.set;
  const [query, setQuery] = useState("");
  const [closed, setClosed] = useState<Record<string, true>>({});
  // The engine session each chat runs, by chat id ("" for none), as native code says.
  const [running, setRunning] = useState<Record<string, string>>({});
  const asked = useRef(new Set<string>());
  const [refreshing, setRefreshing] = useState(false);
  const [continuing, setContinuing] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ key: string; text: string; addAgent: boolean } | null>(
    null,
  );
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Chats with something said in them that work in a project; studio talks are the studio's.
  const chats = useMemo(
    () =>
      conversations.filter(
        (chat) =>
          chat.messages.length > 0 &&
          !chat.archivedAt &&
          !chat.place &&
          Boolean(projectChats?.[chat.id]),
      ),
    [conversations, projectChats],
  );

  const rescan = useCallback(async () => {
    setRefreshing(true);
    try {
      setHistory(await rescanEngineSessions());
    } catch {
      // The last list stays; the next open tries again.
    } finally {
      setRefreshing(false);
    }
  }, [setHistory]);
  useEffect(() => {
    void rescan();
  }, [rescan]);

  // Each chat's engine session, read once the chat shows up. Every chat counts toward which
  // sessions are held, archived ones too, so none shows twice. A refresh reads them again.
  const [round, setRound] = useState(0);
  useEffect(() => {
    const ids = conversations
      .filter((chat) => chat.messages.length > 0 && !asked.current.has(chat.id))
      .map((chat) => chat.id);
    if (!ids.length) return;
    for (const id of ids) asked.current.add(id);
    void eachFew(ids, async (id) => {
      const session = await readChatSession(id).catch(() => null);
      setRunning((current) => ({ ...current, [id]: session ? sessionKey(session) : "" }));
    });
  }, [conversations, round]);

  const refresh = () => {
    asked.current.clear();
    setRunning({});
    setRound((value) => value + 1);
    void useChatFolders
      .getState()
      .loadProjectChats()
      .catch(() => undefined);
    void rescan();
  };

  const held = useMemo(() => {
    const keys = new Set(Object.values(running).filter(Boolean));
    for (const chat of conversations) for (const tag of importedTags(chat)) keys.add(tag);
    return keys;
  }, [conversations, running]);
  // Until every chat has said which session it runs, a held one could show as free.
  const heldKnown = conversations.every(
    (chat) => chat.messages.length === 0 || chat.id in running,
  );
  const foldersPending = projectChats === null;

  const entries = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = (title: string) => !needle || title.toLowerCase().includes(needle);
    const list: Entry[] = [];
    for (const chat of chats) {
      const project = projectChats?.[chat.id];
      if (!project) continue;
      const title = chat.title || "New conversation";
      if (!matches(title)) continue;
      list.push({
        kind: "chat",
        key: `chat:${chat.id}`,
        workspacePath: project,
        updatedAt: Date.parse(chat.updatedAt) || 0,
        title,
        chat,
        agent: chatAgentOf(agents, chat.agentId),
      });
    }
    if (heldKnown)
      for (const session of history.data ?? []) {
        if (session.messageCount === 0 || held.has(sessionKey(session))) continue;
        const title = sessionTitle(session);
        if (!matches(title)) continue;
        list.push({
          kind: "session",
          key: `session:${sessionKey(session)}`,
          workspacePath: session.workspacePath,
          updatedAt: session.updatedAt ?? 0,
          title,
          session,
        });
      }
    return list;
  }, [query, chats, projectChats, agents, heldKnown, history.data, held]);

  const lines = useMemo(() => {
    const out: Line[] = [];
    for (const group of sessionsByFolder(entries)) {
      const open = !closed[group.path];
      out.push({
        kind: "folder",
        key: `folder:${group.path}`,
        path: group.path,
        count: group.sessions.length,
        open,
      });
      if (!open) continue;
      for (const entry of group.sessions) {
        out.push({ kind: "entry", key: entry.key, entry });
        if (notice?.key === entry.key)
          out.push({
            kind: "notice",
            key: `notice:${entry.key}`,
            entry,
            text: notice.text,
            addAgent: notice.addAgent,
          });
      }
    }
    // Chats whose folder is still being read, and the engines' sessions until it's known which
    // are held, come in below.
    if (foldersPending || (!heldKnown && history.data?.length))
      for (let index = 0; index < 3; index += 1)
        out.push({ kind: "loading", key: `loading:${index}` });
    return out;
  }, [entries, closed, notice, foldersPending, heldKnown, history.data]);

  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => uiPx(32),
    overscan: 10,
    getItemKey: (index) => lines[index]?.key ?? index,
  });

  const engineName = (engine: string) =>
    engines?.find((item) => item.id === engine)?.name ?? engine;

  const continueSession = async (entry: Extract<Entry, { kind: "session" }>) => {
    const { session } = entry;
    setNotice(null);
    const agentId = defaultEngineAgent(session.engine);
    if (!agentId) {
      setNotice({
        key: entry.key,
        text: `Add an agent for ${engineName(session.engine)} first`,
        addAgent: true,
      });
      return;
    }
    setContinuing(entry.key);
    try {
      const id = await resumeInNewChat(agentId, { ...session, title: entry.title });
      setRunning((current) => ({ ...current, [id]: sessionKey(session) }));
      // It works in the session's project, so it lists here from now on.
      await useChatFolders
        .getState()
        .loadProjectChats()
        .catch(() => undefined);
      openCodeChat(id);
    } catch (reason) {
      setNotice({
        key: entry.key,
        text: reason instanceof Error ? reason.message : String(reason),
        addAgent: false,
      });
    } finally {
      setContinuing(null);
    }
  };

  const renderLine = (line: Line): ReactNode => {
    switch (line.kind) {
      case "folder":
        return (
          <TreeRow
            label={groupName(line.path)}
            full={line.path}
            chevron
            expanded={line.open}
            end={
              <Text size="meta" tone="muted">
                {line.count}
              </Text>
            }
            onOpen={() =>
              setClosed((current) => {
                const next = { ...current };
                if (next[line.path]) delete next[line.path];
                else next[line.path] = true;
                return next;
              })
            }
          />
        );
      case "entry": {
        const { entry } = line;
        return (
          <TreeRow
            label={entry.title}
            depth={1}
            icon={entryMark(entry)}
            end={<RowTime at={entry.updatedAt} />}
            selected={entry.kind === "chat" && entry.chat.id === openChat}
            onOpen={() => {
              if (continuing) return;
              if (entry.kind === "chat") {
                setNotice(null);
                openCodeChat(entry.chat.id);
              } else void continueSession(entry);
            }}
          />
        );
      }
      case "notice":
        return (
          <Text
            bare
            as="div"
            size="caption"
            tone="danger"
            role="alert"
            className="flex flex-col items-start gap-2 py-2 pr-2 pl-10 break-words"
          >
            <p>{line.text}</p>
            {line.addAgent ? (
              <Button size="sm" variant="secondary" onClick={() => openAgentsHub("agents")}>
                Add agent
              </Button>
            ) : null}
          </Text>
        );
      case "loading":
        return (
          <div aria-hidden="true" className="flex h-8 items-center gap-2 pr-1 pl-6">
            <Skeleton className="size-4 rounded-sm" />
            <Skeleton className="h-3 w-1/2 rounded-sm" />
          </div>
        );
    }
  };

  const firstLoad =
    (conversationsLoading && !conversations.length) || (history.loading && !chats.length);
  let body: ReactNode;
  if (conversationsError && !conversations.length) {
    // The reads go on behind this; the first that works brings the list.
    body = (
      <ErrorState
        inline
        title="Chats couldn't load"
        line={conversationsError}
        action={{
          label: "Try again",
          variant: "secondary",
          onClick: () => void useMistyStore.getState().loadConversations(),
        }}
      />
    );
  } else if (firstLoad) {
    body = <SkeletonList label="Sessions" rows={6} leading="icon" className="px-3" />;
  } else if (!lines.length) {
    body = query.trim() ? (
      <Text size="body" tone="muted" className="px-3 py-2">
        No sessions match
      </Text>
    ) : (
      <EmptyState
        inline
        title="No sessions yet"
        line="Code chats and your engines' own sessions show here, by project."
      />
    );
  } else {
    body = (
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((item) => {
          const line = lines[item.index];
          return (
            <div
              key={item.key}
              data-index={item.index}
              ref={virtualizer.measureElement}
              className="absolute top-0 left-0 w-full px-1"
              style={{ transform: `translateY(${item.start}px)` }}
            >
              {line ? renderLine(line) : null}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 flex-none border-b items-center gap-1 px-2">
        <SearchField
          aria-label="Search sessions"
          placeholder="Search sessions"
          containerClassName="min-w-0 flex-1"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <NewSessionControl project={(openChat && projectChats?.[openChat]) || lastProject} />
        <IconButton label="Refresh sessions" disabled={refreshing} onClick={refresh}>
          <RotateCw />
        </IconButton>
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto pb-2">
        {body}
      </div>
    </div>
  );
}
