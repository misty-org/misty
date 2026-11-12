import {
  CircleGauge,
  GitBranch,
  GitCompareArrows,
  Globe,
  Layers,
  Target,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { AgentProfile } from "@/shared/schemas";
import { OverflowFadeText, Pressable } from "@/shared/ui";
import { EngineMark, hasEngineMark } from "@/features/engine-config/EngineMark";
import { listEngines, mistyEngine, type EngineInfo } from "../engines/enginesApi";
import { MOST_TURNS, useSessionGoals } from "../goals/sessionGoals";
import { useBrowserAttached } from "../conversations/composer/controls/composerChoices";
import {
  useChatContextUsage,
  watchContextUsage,
} from "../conversations/composer/controls/contextUsage";
import { useMistyStore } from "../conversations/state/useMistyStore";
import { useContextPanel } from "./contextPanelStore";
import { FolderPicker, useProjectFolder } from "./FolderPicker";
import { projectApi, type GitStatus } from "./projectApi";
import { chatUsage, formatCost, type ChatUsage } from "./chatUsage";
import { formatTokens } from "../conversations/view/meta/format";

/** A titled group of rows. Groups are parted by space alone; the title can name its subject. */
function Section(props: { title: string; subject?: ReactNode; children: ReactNode }) {
  return (
    <section className="session-section">
      <header className="session-section-head">
        <h3>{props.title}</h3>
        {props.subject ? <span className="session-section-subject">{props.subject}</span> : null}
      </header>
      {props.children}
    </section>
  );
}

function Row(props: {
  icon?: LucideIcon;
  label: ReactNode;
  value?: ReactNode;
  onOpen?(): void;
  /** For a row that shows and hides more rows. */
  expanded?: boolean;
}) {
  const Icon = props.icon;
  const body = (
    <>
      {Icon ? <Icon size={14} strokeWidth={1.75} aria-hidden="true" /> : null}
      <span className="session-row-label">{props.label}</span>
      {props.value === undefined ? null : <span className="session-row-value">{props.value}</span>}
    </>
  );
  return props.onOpen ? (
    <Pressable
      type="button"
      className="session-row"
      aria-expanded={props.expanded}
      onClick={props.onOpen}
    >
      {body}
    </Pressable>
  ) : (
    <div className="session-row">{body}</div>
  );
}

/** The linked folder's branch and how many files differ, read again whenever the folder changes. */
function useGitStatus(folder: string): GitStatus | null {
  const [status, setStatus] = useState<GitStatus | null>(null);
  useEffect(() => {
    setStatus(null);
    if (!folder) return;
    let current = true;
    void projectApi
      .gitStatus(folder)
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
  return {
    ...summary,
    used: summary.used ?? live?.used,
    window: summary.window ?? live?.window,
  };
}

/** The Usage group the Context row opens: the latest reply's tokens, then the whole chat's. */
function UsageDetails({ usage }: { usage: ChatUsage }) {
  const last = usage.last;
  const tokens = (value: number | undefined) => (value ? formatTokens(value) : undefined);
  const rows: Array<[string, string | undefined]> = [
    [
      "In context",
      usage.used
        ? usage.window
          ? `${formatTokens(usage.used)} of ${formatTokens(usage.window)}`
          : formatTokens(usage.used)
        : undefined,
    ],
    ["Input", tokens(last?.input)],
    ["Cached", tokens(last?.cacheRead)],
    ["Cache write", tokens(last?.cacheWrite)],
    ["Output", tokens(last?.output)],
    ["Reasoning", tokens(last?.reasoning)],
    [
      "Cache hits",
      usage.cacheHit !== undefined && last?.cacheRead
        ? `${Math.round(usage.cacheHit * 100)}%`
        : undefined,
    ],
  ];
  return (
    <>
      <Section title="Last reply">
        {rows.map(([label, value]) =>
          value === undefined ? null : <Row key={label} label={label} value={value} />,
        )}
      </Section>
      <Section title="This chat">
        <Row label="Replies" value={usage.replies} />
        <Row label="Tokens in" value={formatTokens(usage.totalIn)} />
        <Row label="Tokens out" value={formatTokens(usage.totalOut)} />
        {usage.costUsd === undefined ? null : (
          <Row label="Cost" value={formatCost(usage.costUsd)} />
        )}
      </Section>
    </>
  );
}

/** The context meter: a thin bar under its row that turns amber, then red, as the window fills. */
function ContextMeter({ share }: { share: number }) {
  return (
    <div
      className="session-meter"
      role="meter"
      aria-label="Context used"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(share * 100)}
      data-level={share >= 0.9 ? "full" : share >= 0.7 ? "high" : undefined}
    >
      <span style={{ width: `${Math.max(2, share * 100)}%` }} />
    </div>
  );
}

function useEngine(id: string): EngineInfo | undefined {
  const [engines, setEngines] = useState<EngineInfo[]>([]);
  useEffect(() => {
    let current = true;
    void listEngines()
      .then((next) => current && setEngines(next))
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, []);
  return engines.find((engine) => engine.id === id);
}

/**
 * The chat's session at a glance, after OpenChamber's session card: which engine and model are
 * answering and how full its context is, the project folder and its branch, the chat's goal, and
 * what Misty lends the engine. A narrow card with no title bar, only as tall as what it holds.
 */
export function SessionPanel(props: { conversationId: string; agent: AgentProfile }) {
  const engineId = props.agent.engine || mistyEngine;
  const outside = engineId !== mistyEngine;
  const engine = useEngine(engineId);
  const { folder } = useProjectFolder();
  const git = useGitStatus(folder);
  const goal = useSessionGoals((state) => state.goals[props.conversationId]);
  const show = useContextPanel((state) => state.show);
  // The browser goes with a message the person attaches it to, not with every one.
  const browser = useBrowserAttached(props.conversationId);
  const usage = useChatUsage(props.conversationId);
  const [details, setDetails] = useState(false);
  const context = usage.used && usage.window ? Math.min(1, usage.used / usage.window) : null;
  const engineName = outside ? (engine?.name ?? engineId) : "Misty";
  return (
    <div className="session-panel">
      <Section title="Session">
        <Row
          label={
            <span className="flex min-w-0 items-center gap-2">
              {hasEngineMark(props.agent.engine) ? (
                <EngineMark engine={props.agent.engine} size={15} />
              ) : null}
              <OverflowFadeText>{props.agent.name}</OverflowFadeText>
            </span>
          }
          value={engineName === props.agent.name ? undefined : engineName}
        />
        {outside ? (
          <Row label="Model" value={props.agent.engine_model || "Engine default"} />
        ) : null}
        {outside && engine?.version ? <Row label="Version" value={engine.version} /> : null}
        {context === null && !usage.replies ? null : (
          <>
            <Row
              icon={CircleGauge}
              label="Context"
              value={
                context === null
                  ? usage.used
                    ? formatTokens(usage.used)
                    : undefined
                  : `${(context * 100).toFixed(context < 0.1 ? 1 : 0)}%`
              }
              expanded={details}
              onOpen={() => setDetails((open) => !open)}
            />
            {context === null ? null : <ContextMeter share={context} />}
          </>
        )}
      </Section>
      {details && usage.replies ? <UsageDetails usage={usage} /> : null}
      <Section title="Project" subject={<FolderPicker compact />}>
        {folder ? (
          <>
            {git?.repository ? (
              <>
                <Row icon={GitBranch} label={git.branch || "No branch"} />
                <Row
                  icon={GitCompareArrows}
                  label="Changes"
                  value={git.changes.length}
                  onOpen={() => show("changes")}
                />
              </>
            ) : null}
          </>
        ) : (
          <p className="session-empty">No folder is linked to this Space.</p>
        )}
      </Section>
      {goal ? (
        <Section title="Goal">
          <Row icon={Target} label={goal.text} value={`${goal.turns}/${MOST_TURNS}`} />
        </Section>
      ) : null}
      {outside ? (
        <Section title="From Misty">
          <Row icon={Layers} label="Space tools" value="On" />
          <Row icon={Globe} label="Browser" value={browser ? "Next message" : "When attached"} />
        </Section>
      ) : null}
    </div>
  );
}
