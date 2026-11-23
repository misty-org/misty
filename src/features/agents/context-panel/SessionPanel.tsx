import {
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  Bot,
  Check,
  Circle,
  CircleDot,
  CircleGauge,
  CircleSlash,
  Coins,
  DatabaseZap,
  Gauge,
  ListChecks,
  FilePen,
  Folder,
  FolderOpen,
  GitBranch,
  House,
  Layers,
  MessageSquare,
  RefreshCw,
  Target,
  Timer,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AgentProfile } from "@/shared/schemas";
import { ActionBar, iconBarItem, Mark, Meter, OverflowFadeText, Text } from "@misty/ui";
import { usageLimits, windowLength, type LimitWindow } from "@/features/engine-config/usage";
import { mistyEngine, useEnginesList, type EngineInfo } from "../engines/engines_api";
import { MOST_TURNS, useSessionGoals } from "../goals/session_goals";
import {
  useChatContextUsage,
  watchContextUsage,
} from "../conversations/composer/controls/context_usage";
import { useMistyStore } from "../conversations/state/use_misty_store";
import { useAgentHomeSpace } from "../personal/AgentSpaceField";
import { ChatFolderMenu } from "../plans/AgentFolderMenu";
import { useContextPanel } from "./context_panel_store";
import { chatKey } from "../conversations/state/draft_chat";
import { useChatFolder } from "../shared-folders/chat_folder";
import { ChatFolderPicker } from "./ChatFolderPicker";
import { gitApi, type GitStatus } from "./git/git_api";
import { LineCounts } from "./git/LineCounts";
import { chatUsage, formatCost, type ChatUsage } from "./chat_usage";
import { formatTokens } from "../conversations/view/meta/format";
import { Row, Section } from "./SessionRows";
import { ContextSources, McpServers, StartCommandRows, TurnStats } from "./SessionSections";
import {
  useEngineTurnStore,
  type EngineTurn,
} from "../conversations/view/engine/engine_turn_store";
import { effortLabel } from "../conversations/composer/controls/engine_options";
import type { EngineTodo } from "../runs/invocations/invocation_event_types";

function useLatestTurn(conversationId: string): EngineTurn | undefined {
  const runId = useMistyStore((state) => {
    const messages = state.conversations.find((chat) => chat.id === conversationId)?.messages;
    for (let index = (messages?.length ?? 0) - 1; index >= 0; index -= 1) {
      const message = messages![index]!;
      if (message.role === "assistant" && message.invocationId) return message.invocationId;
    }
    return undefined;
  });
  return useEngineTurnStore((state) => (runId ? state.byRun[runId] : undefined));
}

const todoIcons = {
  complete: Check,
  active: CircleDot,
  blocked: CircleSlash,
  dropped: CircleSlash,
  pending: Circle,
} as const;

const MOST_TASKS = 6;

function Tasks({ todos }: { todos: EngineTodo[] }) {
  const done = todos.filter((todo) => todo.status === "complete").length;
  const shown = todos.slice(0, MOST_TASKS);
  return (
    <Section title="Tasks" icon={ListChecks} subject={`${done}/${todos.length}`}>
      {shown.map((todo, index) => (
        <Row
          key={todo.id ?? index}
          icon={todoIcons[todo.status ?? "pending"]}
          label={todo.content}
        />
      ))}
      {todos.length > shown.length ? <Empty>{todos.length - shown.length} more</Empty> : null}
    </Section>
  );
}

function useGitStatus(folder: string): GitStatus | null {
  const [status, setStatus] = useState<GitStatus | null>(null);
  useEffect(() => {
    setStatus(null);
    if (!folder) return;
    let current = true;
    void gitApi
      .status(folder)
      .then((next) => current && setStatus(next))
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [folder]);
  return status;
}

function useChatUsage(conversationId: string): ChatUsage {
  useEffect(() => watchContextUsage(), []);
  const messages = useMistyStore(
    (state) => state.conversations.find((chat) => chat.id === conversationId)?.messages,
  );
  const summary = useMemo(
    () => chatUsage((messages ?? []).map((message) => message.usage)),
    [messages],
  );
  const runIds = useMemo(
    () =>
      (messages ?? []).flatMap((message) => (message.invocationId ? [message.invocationId] : [])),
    [messages],
  );
  const live = useChatContextUsage(runIds);
  return { ...summary, used: summary.used ?? live?.used, window: summary.window ?? live?.window };
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <Text size="meta" tone="muted" wrap className="py-1">
      {children}
    </Text>
  );
}

function useEngine(id: string): EngineInfo | undefined {
  return useEnginesList().data?.find((engine) => engine.id === id);
}

const MIN_SPIN_MS = 600;

function useEngineLimits(engine: string) {
  const supported = engine === "claude" || engine === "codex";
  const [windows, setWindows] = useState<LimitWindow[]>([]);
  const [busy, setBusy] = useState(false);
  const load = useCallback(
    async (refresh: boolean) => {
      if (!supported) return;
      setBusy(true);
      try {
        const [result] = await Promise.all([
          usageLimits({ providers: [engine as "claude" | "codex"], refresh }),
          refresh ? new Promise((done) => setTimeout(done, MIN_SPIN_MS)) : null,
        ]);
        const provider = result.providers.find((item) => item.id === engine);
        setWindows(provider?.status === "ok" ? provider.windows : []);
      } catch {
        setWindows([]);
      } finally {
        setBusy(false);
      }
    },
    [engine, supported],
  );
  useEffect(() => {
    setWindows([]);
    void load(false);
  }, [load]);
  return { windows, busy, refresh: () => void load(true) };
}

function windowName(window: LimitWindow): string {
  if (window.label) return window.label;
  if (window.kind === "weekly") return "Weekly";
  if (window.windowSeconds) return windowLength(window.windowSeconds);
  return "Plan";
}

export function SessionPanel(props: {
  conversationId: string;
  agent: AgentProfile;
  corner?: ReactNode;
}) {
  const engineId = props.agent.engine || mistyEngine;
  const outside = engineId !== mistyEngine;
  const engine = useEngine(engineId);
  const { folder, kind } = useChatFolder(props.conversationId);
  const home = useAgentHomeSpace(props.agent);
  const git = useGitStatus(folder);
  const goal = useSessionGoals((state) => state.goals[chatKey(props.conversationId)]);
  const show = useContextPanel((state) => state.show);
  const usage = useChatUsage(props.conversationId);
  const limits = useEngineLimits(outside ? engineId : "");
  const turn = useLatestTurn(props.conversationId);
  const helpers = turn?.subagents.filter((subagent) => subagent.state === "running").length ?? 0;
  const context = usage.used && usage.window ? Math.min(1, usage.used / usage.window) : null;
  const engineName = outside ? (engine?.name ?? engineId) : "Misty";
  const contextValue =
    context === null
      ? usage.used
        ? formatTokens(usage.used)
        : null
      : `${(context * 100).toFixed(context < 0.1 ? 1 : 0)}%`;
  const changed = git ? git.staged.length + git.unstaged.length + git.untracked.length : 0;
  const plans = [...limits.windows].sort(
    (a, b) => Number(b.kind === "session") - Number(a.kind === "session"),
  );
  return (
    <div className="flex min-h-0 flex-[0_1_auto] flex-col gap-4 px-2 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <Section
        title="Session"
        icon={MessageSquare}
        tools={props.corner}
        subject={
          <span className="flex min-w-0 items-center gap-1.5">
            {props.agent.engine ? <Mark of={`engine:${props.agent.engine}`} size="1em" /> : null}
            <OverflowFadeText>
              {outside ? turn?.model || props.agent.engine_model || engineName : engineName}
            </OverflowFadeText>
          </span>
        }
      >
        {contextValue ? (
          <>
            <Row icon={CircleGauge} label="Context" value={contextValue} />
            {context === null ? null : (
              <Meter label="Context used" share={context} className="mt-1 mb-2" />
            )}
          </>
        ) : (
          <Row
            icon={CircleGauge}
            label="Context"
            value={
              <Text bare tone="muted">
                Nothing sent yet
              </Text>
            }
          />
        )}
        {usage.replies ? (
          <Row
            icon={ArrowDownUp}
            label="Tokens"
            value={`${formatTokens(usage.totalIn)} in, ${formatTokens(usage.totalOut)} out`}
          />
        ) : null}
        {usage.costUsd === undefined ? null : (
          <Row icon={Coins} label="Cost" value={formatCost(usage.costUsd)} />
        )}
        {usage.cacheHit === undefined ? null : (
          <Row
            icon={DatabaseZap}
            label="Cache hit"
            value={`${Math.round(usage.cacheHit * 100)}%`}
          />
        )}
        {turn?.effort ? <Row icon={Gauge} label="Effort" value={effortLabel(turn.effort)} /> : null}
        {helpers ? (
          <Row
            icon={Bot}
            label="Sub-agents"
            value={helpers === 1 ? "1 working" : `${helpers} working`}
          />
        ) : null}
        {plans.map((plan, index) => (
          <Row
            key={`${plan.kind}:${plan.label ?? index}`}
            icon={Timer}
            label={`${windowName(plan)} usage`}
            value={
              <span className="flex items-center gap-1">
                {Math.round(plan.usedPercent)}%
                {index ? null : (
                  <ActionBar
                    label="Usage actions"
                    size="sm"
                    width="content"
                    items={[
                      iconBarItem({
                        id: "refresh",
                        icon: RefreshCw,
                        label: "Refresh usage",
                        size: "sm",
                        priority: 1,
                        loading: limits.busy,
                        onSelect: limits.refresh,
                      }),
                    ]}
                  />
                )}
              </span>
            }
          />
        ))}
      </Section>

      {turn?.todos.length ? <Tasks todos={turn.todos} /> : null}

      <Section
        title="Space"
        icon={home?.personal ? House : Layers}
        subject={
          home ? <OverflowFadeText>{home.space?.name ?? "No Space"}</OverflowFadeText> : null
        }
      >
        <Row
          icon={Folder}
          label="Folder"
          value={
            kind === "project" ? (
              <ChatFolderPicker conversationId={props.conversationId} compact />
            ) : (
              "Scratch"
            )
          }
        />
        {outside ? null : (
          <Row
            icon={FolderOpen}
            label="Shared with this chat"
            value={<ChatFolderMenu conversationId={props.conversationId} />}
          />
        )}
        {!folder ? null : git ? (
          <>
            <Row
              icon={GitBranch}
              label={git.branch || "No branch"}
              value={
                git.ahead || git.behind ? (
                  <span className="flex gap-1.5">
                    {git.ahead ? (
                      <span className="flex items-center gap-0.5">
                        <ArrowUp aria-label="Ahead" />
                        {git.ahead}
                      </span>
                    ) : null}
                    {git.behind ? (
                      <span className="flex items-center gap-0.5">
                        <ArrowDown aria-label="Behind" />
                        {git.behind}
                      </span>
                    ) : null}
                  </span>
                ) : undefined
              }
            />
            {changed ? (
              <Row
                icon={FilePen}
                label={changed === 1 ? "1 file changed" : `${changed} files changed`}
                value={<LineCounts git={git} />}
                onOpen={() => show("changes")}
              />
            ) : null}
          </>
        ) : null}
        {folder ? <StartCommandRows conversationId={props.conversationId} folder={folder} /> : null}
      </Section>

      <ContextSources engine={engineId} folder={folder} branch={git?.branch} />

      <McpServers engine={engineId} folder={folder} />

      {goal ? (
        <Section title="Goal" icon={Target} subject={`${goal.turns}/${MOST_TURNS}`}>
          <Row label={goal.text} />
        </Section>
      ) : null}

      <TurnStats conversationId={props.conversationId} />
    </div>
  );
}
