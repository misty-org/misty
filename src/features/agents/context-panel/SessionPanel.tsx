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
import { ActionBar, iconBarItem, Meter, OverflowFadeText, Text } from "@/shared/ui";
import { EngineMark } from "@/features/engine-config/EngineMark";
import { usageLimits, windowLength, type LimitWindow } from "@/features/engine-config/usage";
import { mistyEngine, useEnginesList, type EngineInfo } from "../engines/enginesApi";
import { MOST_TURNS, useSessionGoals } from "../goals/sessionGoals";
import {
  useChatContextUsage,
  watchContextUsage,
} from "../conversations/composer/controls/contextUsage";
import { useMistyStore } from "../conversations/state/useMistyStore";
import { useAgentHomeSpace } from "../personal/AgentSpaceField";
import { ChatFolderMenu } from "../plans/AgentFolderMenu";
import { useContextPanel } from "./contextPanelStore";
import { chatKey } from "../conversations/state/draftChat";
import { ProjectFolderPicker, noFolderLine, useProjectFolder } from "./FolderPicker";
import { gitApi, type GitStatus } from "./git/gitApi";
import { chatUsage, formatCost, type ChatUsage } from "./chatUsage";
import { formatTokens } from "../conversations/view/meta/format";
import { Row, Section } from "./SessionRows";
import { useEngineTurnStore, type EngineTurn } from "../conversations/view/engine/engineTurnStore";
import { effortLabel } from "../conversations/composer/controls/engineOptions";
import type { EngineTodo } from "../runs/invocations/invocationEventTypes";

/** The chat's latest engine turn, live or restored: its model, effort, tasks and sub-agents. */
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

/** A task's glyph: done, under way, blocked or dropped, or still to do. */
const todoIcons = {
  complete: Check,
  active: CircleDot,
  blocked: CircleSlash,
  dropped: CircleSlash,
  pending: Circle,
} as const;

/** The most tasks the card lists before it says how many more there are. */
const MOST_TASKS = 6;

/** The engine's task list for the turn, as it last wrote it. */
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

/** The linked folder's Git state, read again whenever the folder changes; null outside a repository. */
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

/** The chat's usage from its replies' saved reports, with a running reply's live report filling
 * in how full the context is until the reply saves its own. */
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

/** A muted line in a group where its rows would be: nothing yet, or how many more there are. */
function Empty({ children }: { children: ReactNode }) {
  return (
    <Text size="meta" tone="muted" wrap className="py-1">
      {children}
    </Text>
  );
}

/** The chat's engine, from the engine list this computer last read while it is read again. */
function useEngine(id: string): EngineInfo | undefined {
  return useEnginesList().data?.find((engine) => engine.id === id);
}

/** How long a refresh's spinner shows at least. */
const MIN_SPIN_MS = 600;

/** The engine's plan windows (Claude and Codex report them); empty for every other engine. */
function useEngineLimits(engine: string) {
  const supported = engine === "claude" || engine === "codex";
  const [windows, setWindows] = useState<LimitWindow[]>([]);
  const [busy, setBusy] = useState(false);
  const load = useCallback(
    async (refresh: boolean) => {
      if (!supported) return;
      setBusy(true);
      try {
        // A refresh the person asked for spins long enough to be seen, however fast it answers.
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

/** A plan window's name as the card shows it: "5-hour", "Weekly", "Monthly". */
function windowName(window: LimitWindow): string {
  if (window.label) return window.label;
  if (window.kind === "weekly") return "Weekly";
  if (window.windowSeconds) return windowLength(window.windowSeconds);
  return "Plan";
}

/** Lines added and removed across the folder's changed files, in their own colors. */
function LineCounts({ git }: { git: GitStatus }) {
  let added = 0;
  let removed = 0;
  for (const entry of [...git.staged, ...git.unstaged, ...git.untracked]) {
    added += entry.additions ?? 0;
    removed += entry.deletions ?? 0;
  }
  if (!added && !removed) return null;
  return (
    <span className="flex gap-1.5">
      <Text bare tone="added">
        +{added}
      </Text>
      <Text bare tone="removed">
        −{removed}
      </Text>
    </span>
  );
}

/**
 * The chat's session at a glance, in the narrow card beside the chat: the engine's model and how
 * full its context is, what the chat cost and took in tokens, how much the engine's cache served,
 * the turn's effort and working sub-agents, and every plan window the engine reports; then the
 * turn's task list; then where the chat works (its Space, its folder with the branch and
 * changes), and its goal when it has one. Only as tall as what it holds.
 */
export function SessionPanel(props: { conversationId: string; agent: AgentProfile }) {
  const engineId = props.agent.engine || mistyEngine;
  const outside = engineId !== mistyEngine;
  const engine = useEngine(engineId);
  const { folder } = useProjectFolder(props.agent);
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
  const contextValue = [
    context === null
      ? usage.used
        ? formatTokens(usage.used)
        : null
      : `${(context * 100).toFixed(context < 0.1 ? 1 : 0)}%`,
    usage.costUsd === undefined ? null : formatCost(usage.costUsd),
  ]
    .filter(Boolean)
    .join(" · ");
  const changed = git ? git.staged.length + git.unstaged.length + git.untracked.length : 0;
  // The plan windows the engine reports, its session window first.
  const plans = [...limits.windows].sort(
    (a, b) => Number(b.kind === "session") - Number(a.kind === "session"),
  );
  return (
    // Groups parted by space alone; the card scrolls, never showing a scrollbar of its own.
    <div className="flex min-h-0 flex-[0_1_auto] flex-col gap-5 px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <Section
        title="Session"
        icon={MessageSquare}
        subject={
          <span className="flex min-w-0 items-center gap-1.5">
            {props.agent.engine ? <EngineMark engine={props.agent.engine} size={13} /> : null}
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
          <Empty>Nothing sent yet.</Empty>
        )}
        {usage.replies ? (
          <Row
            icon={ArrowDownUp}
            label="Tokens"
            value={`${formatTokens(usage.totalIn)} in · ${formatTokens(usage.totalOut)} out`}
          />
        ) : null}
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
        <Row icon={Folder} label="Folder" value={<ProjectFolderPicker agent={props.agent} />} />
        {outside ? null : (
          <Row
            icon={FolderOpen}
            label="Shared with this chat"
            value={<ChatFolderMenu conversationId={props.conversationId} />}
          />
        )}
        {!folder ? (
          <Empty>{noFolderLine(props.agent)}</Empty>
        ) : git ? (
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
      </Section>

      {goal ? (
        <Section title="Goal" icon={Target} subject={`${goal.turns}/${MOST_TURNS}`}>
          <Row label={goal.text} />
        </Section>
      ) : null}
    </div>
  );
}
