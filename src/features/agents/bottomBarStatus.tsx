import {
  Clock,
  Coins,
  Cpu,
  FolderOpen,
  GitBranch,
  Globe,
  Gauge,
  MessageSquareDot,
  MousePointer2,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button, Text, Tooltip } from "@/shared/ui";
import { runtimeAiApi } from "./AgentsRuntime";
import { useSpaceRuns } from "./activity/useSpaceRuns";
import { setBrowserExpanded, useAgentBrowser } from "./agent-browser/agentBrowserStore";
import { useChatChoices } from "./conversations/composer/controls/composerChoices";
import {
  useChatContextUsage,
  watchContextUsage,
} from "./conversations/composer/controls/contextUsage";
import { isChatUnread } from "./conversations/state/chatOrganizing";
import { useMistyStore } from "./conversations/state/useMistyStore";
import { resolveContextMax } from "./conversations/view/meta/contextWindowMemory";
import { usageBreakdown } from "./conversations/view/meta/usageBreakdown";
import { chatUsage, formatCost } from "./context-panel/chatUsage";
import { useContextPanel } from "./context-panel/contextPanelStore";
import { useGitStore } from "./context-panel/git/store";
import { mistyEngine } from "./engines/enginesApi";
import { usePersonalAgentsStore } from "./personal/personalAgentsStore";
import { watchAllRunEvents } from "./runs/local-run/localRunEvents";
import { useAgentFolder } from "./shared-folders/agentFolder";
import { setCompanionOn, useCompanionOn } from "./tutor/cursor/companionOn";
import { useCompanionState } from "./tutor/cursor/companionState";
import { useLessonStore } from "./tutor/lessons/lessonStore";
import { tutorChatIds, useTutorStore } from "./tutor/tutorStore";

/*
 * The agents' items for the window's bottom bar (Settings › Interface › Bottom bar). Each draws
 * nothing until it has something to say. The window-wide ones open a chat through `onOpenChat`;
 * the chat ones read the focused pane's chat (`conversationId`) and open its context panel.
 */

type OpenChat = (agentId: string, conversationId: string) => void;
type FocusedChat = { conversationId: string };

/** A chat's agent: its own, or Misty for a chat with none. */
function useChatAgent(conversationId: string) {
  const agentId = useMistyStore(
    (state) => state.conversations.find((chat) => chat.id === conversationId)?.agentId,
  );
  return usePersonalAgentsStore((state) =>
    agentId
      ? state.agents.find((agent) => agent.id === agentId)
      : state.agents.find((agent) => agent.system_managed),
  );
}

function agentOf(conversationId: string): string {
  const chat = useMistyStore.getState().conversations.find((item) => item.id === conversationId);
  if (chat?.agentId) return chat.agentId;
  return usePersonalAgentsStore.getState().agents.find((agent) => agent.system_managed)?.id ?? "";
}

/** Every chat's newest top-level run state, kept current as runs report. */
function useRunStates(): Record<string, string> {
  const [states, setStates] = useState<Record<string, string>>({});
  useEffect(() => {
    let live = true;
    let timer: number | undefined;
    const refresh = () =>
      void Promise.resolve()
        .then(() => runtimeAiApi.activity(""))
        .then((result) => {
          if (!live) return;
          const newest = new Map<string, { at: string; state: string }>();
          for (const entry of result.entries) {
            if (entry.parent_run_id || !entry.conversation_id) continue;
            const known = newest.get(entry.conversation_id);
            if (!known || entry.updated_at > known.at)
              newest.set(entry.conversation_id, { at: entry.updated_at, state: entry.state });
          }
          setStates(Object.fromEntries([...newest].map(([id, run]) => [id, run.state])));
        })
        .catch(() => undefined);
    refresh();
    const stop = watchAllRunEvents(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(refresh, 500);
    });
    return () => {
      live = false;
      window.clearTimeout(timer);
      stop();
    };
  }, []);
  return states;
}

/** Runs waiting for the person to approve a tool. Opens the first. */
export function ApprovalsStatus({ onOpenChat }: { onOpenChat: OpenChat }) {
  const states = useRunStates();
  const waiting = Object.keys(states).filter((id) => states[id] === "awaiting_approval");
  if (!waiting.length) return null;
  return (
    <Button
      variant="quiet"
      icon={ShieldCheck}
      onClick={() => onOpenChat(agentOf(waiting[0]), waiting[0])}
    >
      {`${waiting.length} to approve`}
    </Button>
  );
}

/** An agent driving its browser, in a chat that may not be in view. Opens it, browser and all. */
export function AgentBrowsingStatus({ onOpenChat }: { onOpenChat: OpenChat }) {
  const chats = useAgentBrowser((state) => state.chats);
  const browsing = Object.keys(chats).filter((id) =>
    chats[id]?.views.some((view) => view.status === "working"),
  );
  if (!browsing.length) return null;
  const open = () => {
    setBrowserExpanded(browsing[0], true);
    onOpenChat(agentOf(browsing[0]), browsing[0]);
  };
  return (
    <Button variant="quiet" icon={Globe} onClick={open}>
      {browsing.length === 1 ? "Agent browsing" : `${browsing.length} agents browsing`}
    </Button>
  );
}

/** Chats with replies not yet read, as the sidebar counts them. Opens the newest. */
export function UnreadStatus({ onOpenChat }: { onOpenChat: OpenChat }) {
  const conversations = useMistyStore((state) => state.conversations);
  const lessons = useLessonStore((state) => state.lessons);
  const jobs = useTutorStore((state) => state.jobs);
  const notebooks = useTutorStore((state) => state.notebooks);
  const unread = useMemo(() => {
    const made = tutorChatIds(jobs, notebooks);
    return conversations
      .filter(
        (chat) =>
          chat.messages.length > 0 && !lessons[chat.id] && !made.has(chat.id) && isChatUnread(chat),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [conversations, lessons, jobs, notebooks]);
  if (!unread.length) return null;
  return (
    <Button
      variant="quiet"
      icon={MessageSquareDot}
      onClick={() => onOpenChat(agentOf(unread[0].id), unread[0].id)}
    >
      {`${unread.length} unread`}
    </Button>
  );
}

const tutorWords = {
  idle: "Tutor on",
  listening: "Tutor listening",
  processing: "Tutor thinking",
  responding: "Tutor speaking",
} as const;

/** While the cursor companion is on: what it is doing. Turns it off. */
export function TutorStatus() {
  const on = useCompanionOn();
  const phase = useCompanionState((state) => state.presentation.phase);
  if (!on) return null;
  return (
    <Tooltip content="Turn Tutor off">
      <Button variant="quiet" icon={MousePointer2} onClick={() => void setCompanionOn(false)}>
        {tutorWords[phase as keyof typeof tutorWords] ?? "Tutor on"}
      </Button>
    </Tooltip>
  );
}

/** The model the focused chat uses. */
export function ChatModelStatus({ conversationId }: FocusedChat) {
  const choices = useChatChoices(conversationId);
  const agent = useChatAgent(conversationId);
  if (!agent) return null;
  return (
    <Tooltip content="This chat's model">
      <Text bare size="control" tone="muted" className="flex h-8 items-center gap-1.5 px-2">
        <Cpu aria-hidden="true" />
        {choices.model || "Default model"}
      </Text>
    </Tooltip>
  );
}

/** How full the focused chat's context window is. Opens the session card. */
export function ContextStatus({ conversationId }: FocusedChat) {
  useEffect(() => {
    watchContextUsage();
  }, []);
  const agent = useChatAgent(conversationId);
  const runIds = useMistyStore((state) =>
    (state.conversations.find((chat) => chat.id === conversationId)?.messages ?? [])
      .flatMap((message) => (message.invocationId ? [message.invocationId] : []))
      .join(" "),
  );
  const usage = useChatContextUsage(runIds ? runIds.split(" ") : []);
  const choices = useChatChoices(conversationId);
  const engine = agent?.engine || mistyEngine;
  const max = resolveContextMax({ usage, engine, model: usage?.model || choices.model });
  const { pct } = usageBreakdown(usage, max);
  if (pct === undefined) return null;
  return (
    <Tooltip content="Context used">
      <Button
        variant="quiet"
        icon={Gauge}
        onClick={() => useContextPanel.getState().toggle("session")}
      >
        {`${pct}%`}
      </Button>
    </Tooltip>
  );
}

/** What the focused chat has cost on the person's own keys. Opens the session card. */
export function CostStatus({ conversationId }: FocusedChat) {
  const messages = useMistyStore(
    (state) => state.conversations.find((chat) => chat.id === conversationId)?.messages,
  );
  const cost = useMemo(
    () => chatUsage((messages ?? []).map((message) => message.usage)).costUsd,
    [messages],
  );
  if (!cost) return null;
  return (
    <Tooltip content="This chat's cost">
      <Button
        variant="quiet"
        icon={Coins}
        onClick={() => useContextPanel.getState().toggle("session")}
      >
        {formatCost(cost)}
      </Button>
    </Tooltip>
  );
}

/** The focused chat's folder, by name. Opens Files. */
export function FolderStatus({ conversationId }: FocusedChat) {
  const folder = useAgentFolder(useChatAgent(conversationId));
  if (!folder) return null;
  return (
    <Tooltip content={folder}>
      <Button
        variant="quiet"
        icon={FolderOpen}
        onClick={() => useContextPanel.getState().toggle("files")}
      >
        {folder.split(/[\\/]/).filter(Boolean).pop() ?? folder}
      </Button>
    </Tooltip>
  );
}

/** The focused chat's folder's branch and its uncommitted lines. Opens Changes. */
export function BranchStatus({ conversationId }: FocusedChat) {
  const folder = useAgentFolder(useChatAgent(conversationId));
  const status = useGitStore((state) => (folder ? state.statusByWorkspace[folder] : undefined));
  useEffect(() => {
    if (folder) void useGitStore.getState().refresh(folder);
  }, [folder]);
  if (!status?.branch) return null;
  let added = 0;
  let removed = 0;
  for (const file of [...status.staged, ...status.unstaged, ...status.untracked]) {
    added += file.additions ?? 0;
    removed += file.deletions ?? 0;
  }
  return (
    <Button
      variant="quiet"
      icon={GitBranch}
      onClick={() => useContextPanel.getState().toggle("changes")}
    >
      {added || removed ? `${status.branch} +${added} −${removed}` : status.branch}
    </Button>
  );
}

/** How long the focused chat's current run has gone, while it runs. */
export function RunTimeStatus({ conversationId }: FocusedChat) {
  const { runs } = useSpaceRuns();
  const run = runs?.find((row) => row.conversationId === conversationId && row.state === "running");
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!run) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [run]);
  if (!run) return null;
  const seconds = Math.max(0, Math.floor((now - run.startedAt) / 1000));
  const text = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return (
    <Tooltip content="This run's time">
      <Text bare size="control" tone="muted" className="flex h-8 items-center gap-1.5 px-2">
        <Clock aria-hidden="true" />
        {text}
      </Text>
    </Tooltip>
  );
}
