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
import { Button, Text, Tooltip } from "@misty/ui";
import { runtimeAiApi } from "./agents_runtime";
import { useSpaceRuns } from "./activity/use_space_runs";
import { setBrowserExpanded, useAgentBrowser } from "./agent-browser/agent_browser_store";
import { useChatChoices } from "./conversations/composer/controls/composer_choices";
import {
  useChatContextUsage,
  watchContextUsage,
} from "./conversations/composer/controls/context_usage";
import { isChatUnread } from "./conversations/state/chat_organizing";
import { useMistyStore } from "./conversations/state/use_misty_store";
import { resolveContextMax } from "./conversations/view/meta/context_window_memory";
import { usageBreakdown } from "./conversations/view/meta/usage_breakdown";
import { chatUsage, formatCost } from "./context-panel/chat_usage";
import { useContextPanel } from "./context-panel/context_panel_store";
import { LineCounts } from "./context-panel/git/LineCounts";
import { useGitStore } from "./context-panel/git/store";
import { mistyEngine } from "./engines/engines_api";
import { usePersonalAgentsStore } from "./personal/personal_agents_store";
import { watchAllRunEvents } from "./runs/local-run/local_run_events";
import { useChatFolder } from "./shared-folders/chat_folder";
import { setCompanionOn, useCompanionOn } from "./tutor/cursor/companion_on";
import { useCompanionState } from "./tutor/cursor/companion_state";
import { useLessonStore } from "./tutor/lessons/lesson_store";

type OpenChat = (agentId: string, conversationId: string) => void;
type FocusedChat = { conversationId: string };

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

export function UnreadStatus({ onOpenChat }: { onOpenChat: OpenChat }) {
  const conversations = useMistyStore((state) => state.conversations);
  const lessons = useLessonStore((state) => state.lessons);
  const unread = useMemo(() => {
    return conversations
      .filter((chat) => chat.messages.length > 0 && !lessons[chat.id] && isChatUnread(chat))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [conversations, lessons]);
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
  const pct = usageBreakdown(usage, max)?.pct;
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

export function FolderStatus({ conversationId }: FocusedChat) {
  const { folder, kind } = useChatFolder(conversationId);
  if (!folder) return null;
  return (
    <Tooltip content={folder}>
      <Button
        variant="quiet"
        icon={FolderOpen}
        onClick={() => useContextPanel.getState().toggle("files")}
      >
        {kind === "scratch" ? "Scratch" : (folder.split(/[\\/]/).filter(Boolean).pop() ?? folder)}
      </Button>
    </Tooltip>
  );
}

export function BranchStatus({ conversationId }: FocusedChat) {
  const { folder } = useChatFolder(conversationId);
  const status = useGitStore((state) => (folder ? state.statusByWorkspace[folder] : undefined));
  useEffect(() => {
    if (folder) void useGitStore.getState().refresh(folder);
  }, [folder]);
  if (!status?.branch) return null;
  return (
    <Button
      variant="quiet"
      icon={GitBranch}
      onClick={() => useContextPanel.getState().toggle("changes")}
    >
      <span className="flex items-center gap-1.5">
        {status.branch}
        <LineCounts git={status} />
      </span>
    </Button>
  );
}

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
