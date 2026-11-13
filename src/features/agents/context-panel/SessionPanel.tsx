import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  BookOpen,
  ChevronDown,
  CircleGauge,
  Database,
  FilePen,
  Folder,
  GitBranch,
  Globe,
  Layers,
  MessageSquare,
  Plug,
  RefreshCw,
  Target,
  Timer,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AgentProfile } from "@/shared/schemas";
import { IconButton, OverflowFadeText, Pressable, Switch } from "@/shared/ui";
import { EngineMark } from "@/features/engine-config/EngineMark";
import { useMcpInventory } from "@/features/engine-config/mcp";
import { skillsHubApi } from "@/features/engine-config/skills";
import { usageLimits, type LimitWindow } from "@/features/engine-config/usage";
import { openSettings } from "@/features/settings";
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
import { gitApi, type GitStatus } from "./git/gitApi";
import { chatUsage, formatCost, type ChatUsage } from "./chatUsage";
import { formatTokens } from "../conversations/view/meta/format";

/**
 * A titled group of rows. The title carries its glyph and, at the far end, what it is about (the
 * folder, a count). A group that folds says so with a chevron before its title.
 */
function Section(props: {
  title: string;
  icon?: LucideIcon;
  subject?: ReactNode;
  open?: boolean;
  onToggle?(): void;
  children?: ReactNode;
}) {
  const Icon = props.icon;
  const title = (
    <>
      {props.onToggle ? (
        <ChevronDown
          size={14}
          aria-hidden="true"
          className="session-section-chevron"
          data-open={props.open || undefined}
        />
      ) : Icon ? (
        <Icon size={14} strokeWidth={1.75} aria-hidden="true" />
      ) : null}
      <h3>{props.title}</h3>
    </>
  );
  return (
    <section className="session-section">
      <header className="session-section-head">
        {props.onToggle ? (
          <Pressable
            type="button"
            className="session-section-toggle"
            aria-expanded={props.open}
            onClick={props.onToggle}
          >
            {title}
          </Pressable>
        ) : (
          title
        )}
        {props.subject ? <span className="session-section-subject">{props.subject}</span> : null}
      </header>
      {props.onToggle && !props.open ? null : props.children}
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
      <span className="session-row-label">
        <OverflowFadeText>{props.label}</OverflowFadeText>
      </span>
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
function useChatUsage(conversationId: string): ChatUsage & { lastDurationMs?: number } {
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
  const lastDurationMs = useMemo(
    () => [...(messages ?? [])].reverse().find((message) => message.durationMs)?.durationMs,
    [messages],
  );
  const live = useChatContextUsage(runIds);
  return {
    ...summary,
    used: summary.used ?? live?.used,
    window: summary.window ?? live?.window,
    lastDurationMs,
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
    ["Replies", String(usage.replies)],
    ["Tokens in", formatTokens(usage.totalIn)],
    ["Tokens out", formatTokens(usage.totalOut)],
  ];
  return (
    <div className="session-details">
      {rows.map(([label, value]) =>
        value === undefined ? null : <Row key={label} label={label} value={value} />,
      )}
    </div>
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

/** How many of the person's skills are synced to this engine; null until known. */
function useSkillCount(engine: string): number | null {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    setCount(null);
    if (!engine) return;
    let current = true;
    void skillsHubApi
      .installed()
      .then(
        (result) =>
          current &&
          setCount(
            result.skills.filter((skill) => (skill.targets as string[]).includes(engine)).length,
          ),
      )
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [engine]);
  return count;
}

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
        const result = await usageLimits({ providers: [engine as "claude" | "codex"], refresh });
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

/** A plan window's name as the card shows it: "5-hour", "Weekly". */
function windowName(window: LimitWindow): string {
  if (window.label) return window.label;
  if (window.kind === "weekly") return "Weekly";
  if (window.windowSeconds) return `${Math.round(window.windowSeconds / 3600)}-hour`;
  return "Plan";
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
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
    <span className="session-lines">
      <span data-tone="added">+{added}</span>
      <span data-tone="removed">−{removed}</span>
    </span>
  );
}

/**
 * The chat's session at a glance, after OpenChamber's session card: how full the engine's context
 * is and what the chat cost, the project folder with its branch and changes, what the engine has
 * to work with (skills, MCP servers, Space tools, the browser), its plan usage, each MCP server's
 * switch, and the last turn. A narrow card with no title bar, only as tall as what it holds.
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
  const skills = useSkillCount(outside ? engineId : "");
  const limits = useEngineLimits(outside ? engineId : "");
  const mcp = useMcpInventory(folder || null);
  const mcpEntries = useMemo(
    () =>
      mcp.inventory?.engines.find((item) => item.id === engineId)?.config.entries ??
      ([] as never[]),
    [mcp.inventory, engineId],
  );
  const [details, setDetails] = useState(false);
  const [mcpOpen, setMcpOpen] = useState(true);
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
  const session = limits.windows.find((window) => window.kind === "session") ?? limits.windows[0];
  const enabledMcp = mcpEntries.filter((entry) => entry.enabled).length;
  const lastCost = usage.last?.costUsd;
  return (
    <div className="session-panel">
      <Section
        title="Session"
        icon={MessageSquare}
        subject={
          <span className="flex min-w-0 items-center gap-1.5">
            {props.agent.engine ? <EngineMark engine={props.agent.engine} size={13} /> : null}
            <OverflowFadeText>
              {outside ? props.agent.engine_model || engineName : engineName}
            </OverflowFadeText>
          </span>
        }
      >
        {contextValue ? (
          <>
            <Row
              icon={CircleGauge}
              label="Context"
              value={contextValue}
              expanded={details}
              onOpen={usage.replies ? () => setDetails((open) => !open) : undefined}
            />
            {context === null ? null : <ContextMeter share={context} />}
            {details && usage.replies ? <UsageDetails usage={usage} /> : null}
          </>
        ) : (
          <p className="session-empty">Nothing sent yet.</p>
        )}
        {usage.cacheHit !== undefined && usage.last?.cacheRead ? (
          <Row icon={Database} label="Cache hit" value={`${(usage.cacheHit * 100).toFixed(1)}%`} />
        ) : null}
      </Section>

      <Section title="Project" icon={Folder} subject={<FolderPicker compact />}>
        {!folder ? (
          <p className="session-empty">No folder is linked to this Space.</p>
        ) : git ? (
          <>
            <Row
              icon={GitBranch}
              label={git.branch || "No branch"}
              value={
                git.ahead || git.behind ? (
                  <span className="session-sync">
                    {git.ahead ? (
                      <span>
                        <ArrowUp size={12} aria-label="Ahead" />
                        {git.ahead}
                      </span>
                    ) : null}
                    {git.behind ? (
                      <span>
                        <ArrowDown size={12} aria-label="Behind" />
                        {git.behind}
                      </span>
                    ) : null}
                  </span>
                ) : undefined
              }
            />
            <Row
              icon={FilePen}
              label={changed === 1 ? "1 file changed" : `${changed} files changed`}
              value={<LineCounts git={git} />}
              onOpen={() => show("changes")}
            />
          </>
        ) : null}
      </Section>

      {outside ? (
        <Section title="Engine" icon={Layers} subject={engine?.version}>
          {skills === null ? null : (
            <Row
              icon={BookOpen}
              label="Skills"
              value={skills}
              onOpen={() => openSettings("engine-skills")}
            />
          )}
          {mcp.inventory ? (
            <Row
              icon={Plug}
              label="MCP servers"
              value={enabledMcp}
              onOpen={() => openSettings("engine-mcp")}
            />
          ) : null}
          <Row icon={Layers} label="Space tools" value="On" />
          <Row icon={Globe} label="Browser" value={browser ? "Next message" : "When attached"} />
        </Section>
      ) : null}

      {session ? (
        <Section
          title="Usage"
          icon={Timer}
          subject={
            <span className="flex items-center gap-1">
              <span>
                {windowName(session)} {Math.round(session.usedPercent)}%
              </span>
              <IconButton
                label="Refresh usage"
                size="sm"
                disabled={limits.busy}
                onClick={limits.refresh}
              >
                <RefreshCw size={12} />
              </IconButton>
            </span>
          }
        >
          {limits.windows
            .filter((window) => window !== session)
            .map((window) => (
              <Row
                key={window.id}
                label={windowName(window)}
                value={`${Math.round(window.usedPercent)}%`}
              />
            ))}
        </Section>
      ) : null}

      {outside && mcpEntries.length ? (
        <Section
          title="MCP"
          open={mcpOpen}
          onToggle={() => setMcpOpen((open) => !open)}
          subject={`${enabledMcp}/${mcpEntries.length}`}
        >
          {mcpEntries.map((entry) => (
            <label key={entry.id} className="session-row session-switch-row">
              <Switch
                checked={entry.enabled}
                disabled={!entry.writable || mcp.pendingId === entry.id}
                onCheckedChange={(enabled) => void mcp.setEnabled(entry, enabled)}
                aria-label={entry.name}
              />
              <span className="session-row-label">
                <OverflowFadeText>{entry.name}</OverflowFadeText>
              </span>
            </label>
          ))}
        </Section>
      ) : null}

      {goal ? (
        <Section title="Goal" icon={Target} subject={`${goal.turns}/${MOST_TURNS}`}>
          <Row label={goal.text} />
        </Section>
      ) : null}

      {usage.lastDurationMs || lastCost !== undefined ? (
        <Section
          title="Turn stats"
          icon={BarChart3}
          subject={[
            usage.lastDurationMs ? formatDuration(usage.lastDurationMs) : null,
            lastCost === undefined ? null : formatCost(lastCost),
          ]
            .filter(Boolean)
            .join(" · ")}
        />
      ) : null}
    </div>
  );
}
