// Sections after OpenChamber's session sidebar (MIT, Copyright (c) 2025 Bohdan Triapitsyn).
import {
  Brain,
  ChartNoAxesColumn,
  CircleDot,
  Coins,
  Clock,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  Hourglass,
  Library,
  MessagesSquare,
  Play,
  Plug,
  Receipt,
  ScrollText,
  TimerReset,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useCachedResource } from "@/api/cache/cached-resource";
import { useWorkspaceViewId } from "@/features/app-windows";
import { readonlyReasonText, useMcpInventory } from "@/features/engine-config/mcp";
import { useInstalledSkills } from "@/features/engine-config/skills";
import { openSettings } from "@/features/settings";
import { openExternalLink } from "@/shared/platform/openExternalLink";
import { Switch, Tooltip } from "@/shared/ui";
import { formatTokens, tookText } from "../conversations/view/meta/format";
import { useMistyStore } from "../conversations/state/useMistyStore";
import { mistyEngine } from "../engines/enginesApi";
import { formatCost, turnStats } from "./chatUsage";
import { gitApi, type BranchPullRequest } from "./git/gitApi";
import { useLaunchScripts } from "./launch-script/launchScripts";
import { runLaunchScript } from "./launch-script/runLaunchScript";
import { Row, Section } from "./SessionRows";
import { terminalChatKey } from "./terminal/terminalStore";

const noScripts: never[] = [];

/**
 * The folder's start commands, one row each: pressing one runs it in the chat's launch tab, as
 * the play button in the panel's head does. Nothing shows until the folder has one.
 */
export function StartCommandRows(props: { conversationId: string; folder: string }) {
  const entries = useLaunchScripts((state) => state.byFolder[props.folder] ?? noScripts);
  const chat = terminalChatKey(props.conversationId, useWorkspaceViewId());
  useEffect(() => {
    if (props.folder) void useLaunchScripts.getState().load(props.folder).catch(() => undefined);
  }, [props.folder]);
  return entries.map((entry) => (
    <Row
      key={entry.id}
      icon={Play}
      label={entry.label || entry.script}
      onOpen={() => void runLaunchScript(chat, props.folder, entry).catch(() => undefined)}
    />
  ));
}

/** What a pull request's checks and state read as, the way GitHub words them. */
function pullRequestStatus(pr: BranchPullRequest): string {
  if (pr.state === "MERGED") return "Merged";
  if (pr.state === "CLOSED") return "Closed";
  if (pr.checks === "failing") return "Checks failing";
  if (pr.checks === "pending") return "Checks running";
  if (pr.checks === "passing") return "Checks passing";
  return pr.draft ? "Draft" : "Open";
}

function pullRequestIcon(pr: BranchPullRequest): LucideIcon {
  if (pr.state === "MERGED") return GitMerge;
  if (pr.state === "CLOSED") return GitPullRequestClosed;
  return pr.draft ? GitPullRequestDraft : GitPullRequest;
}

/** The skills the chat's engine reads, from the installed list this computer last scanned. */
function useEngineSkills(engine: string): number | null {
  const skills = useInstalledSkills(engine !== mistyEngine);
  return useMemo(() => {
    if (!skills.targets.some((target) => target.id === engine)) return null;
    return skills.skills.filter((skill) => skill.targets.includes(engine as never)).length;
  }, [skills.skills, skills.targets, engine]);
}

/**
 * What the chat works from beyond its messages: the branch's pull request and the issues it
 * closes, read through the person's own GitHub CLI, and the skills its engine has. Rows open
 * them on GitHub, or the skills in Settings.
 */
export function ContextSources(props: { engine: string; folder: string; branch?: string }) {
  const [open, setOpen] = useState(true);
  const prKey = props.folder && props.branch ? `agents/branch-pr:${props.folder}:${props.branch}` : null;
  const pr = useCachedResource(prKey, () => gitApi.pullRequest(props.folder)).data ?? null;
  const skills = useEngineSkills(props.engine);
  if (!pr && skills === null) return null;
  const subject = [
    pr?.issues.length ? (pr.issues.length === 1 ? "1 issue" : `${pr.issues.length} issues`) : null,
    pr ? "1 PR" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Section
      title="Context sources"
      icon={Library}
      subject={subject || undefined}
      open={open}
      onToggle={() => setOpen((value) => !value)}
    >
      {pr?.issues.map((issue) => (
        <Row
          key={issue.number}
          icon={CircleDot}
          label={
            `#${issue.number}` +
            (issue.state ? ` · Issue ${issue.state === "OPEN" ? "open" : "closed"}` : "") +
            (issue.title ? ` · ${issue.title}` : "")
          }
          onOpen={issue.url ? () => void openExternalLink(issue.url!) : undefined}
        />
      ))}
      {pr ? (
        <Row
          icon={pullRequestIcon(pr)}
          label={`#${pr.number} · ${pullRequestStatus(pr)} · ${pr.title}`}
          onOpen={() => void openExternalLink(pr.url)}
        />
      ) : null}
      {skills === null ? null : (
        <Row
          icon={ScrollText}
          label="Skills"
          value={String(skills)}
          onOpen={() => openSettings("engine-skills")}
        />
      )}
    </Section>
  );
}

/**
 * The chat's engine's MCP servers with their switches. A switch writes the CLI's own config, so
 * it holds for every chat on that engine (and in the CLI itself); a read-only one says why.
 */
export function McpServers(props: { engine: string; folder: string }) {
  const [open, setOpen] = useState(true);
  const outside = props.engine !== mistyEngine;
  const store = useMcpInventory(outside ? props.folder || null : null);
  const engine = outside
    ? store.inventory?.engines.find((item) => item.id === props.engine)
    : undefined;
  const entries = engine?.support === "none" ? [] : (engine?.config.entries ?? []);
  if (!entries.length) return null;
  const on = entries.filter((entry) => entry.enabled).length;
  // The same name from two config files says which file each switch writes.
  const names = new Map<string, number>();
  for (const entry of entries) names.set(entry.name, (names.get(entry.name) ?? 0) + 1);
  return (
    <Section
      title="MCP"
      icon={Plug}
      subject={`${on}/${entries.length}`}
      open={open}
      onToggle={() => setOpen((value) => !value)}
    >
      {entries.map((entry) => {
        const reason = entry.writable ? "" : readonlyReasonText(entry);
        const toggle = (
          <Switch
            aria-label={`${entry.name} on`}
            checked={entry.enabled}
            disabled={!entry.writable || store.pendingId === entry.id}
            onCheckedChange={(enabled) =>
              void store.setEnabled(entry, enabled).catch(() => undefined)
            }
          />
        );
        return (
          <Row
            key={entry.id}
            label={(names.get(entry.name) ?? 0) > 1 ? `${entry.name} (${entry.scope})` : entry.name}
            value={
              reason ? (
                <Tooltip content={reason}>
                  <span className="flex">{toggle}</span>
                </Tooltip>
              ) : (
                toggle
              )
            }
          />
        );
      })}
      <Row icon={Plug} label="All MCP servers" onOpen={() => openSettings("engine-mcp")} />
    </Section>
  );
}

/** How the chat's turns went: how many, how long, and what the latest one spent. Folded at first. */
export function TurnStats(props: { conversationId: string }) {
  const [open, setOpen] = useState(false);
  const messages = useMistyStore(
    (state) => state.conversations.find((chat) => chat.id === props.conversationId)?.messages,
  );
  const stats = useMemo(() => turnStats(messages ?? []), [messages]);
  if (!stats.finished && !stats.stopped) return null;
  const turns = stats.finished + stats.stopped;
  return (
    <Section
      title="Turn stats"
      icon={ChartNoAxesColumn}
      subject={turns === 1 ? "1 turn" : `${turns} turns`}
      open={open}
      onToggle={() => setOpen((value) => !value)}
    >
      <Row
        icon={MessagesSquare}
        label="Replies"
        value={stats.stopped ? `${stats.finished} · ${stats.stopped} stopped` : String(stats.finished)}
      />
      {stats.lastMs ? <Row icon={Clock} label="Last turn" value={tookText(stats.lastMs)} /> : null}
      {stats.averageMs ? (
        <Row icon={Hourglass} label="Average turn" value={tookText(stats.averageMs)} />
      ) : null}
      {stats.longestMs && turns > 1 ? (
        <Row icon={TimerReset} label="Longest turn" value={tookText(stats.longestMs)} />
      ) : null}
      {stats.lastIn !== undefined ? (
        <Row
          icon={Coins}
          label="Last turn tokens"
          value={`${formatTokens(stats.lastIn)} in · ${formatTokens(stats.lastOut ?? 0)} out`}
        />
      ) : null}
      {stats.lastReasoning ? (
        <Row icon={Brain} label="Reasoning" value={formatTokens(stats.lastReasoning)} />
      ) : null}
      {stats.averageCostUsd !== undefined ? (
        <Row icon={Receipt} label="Cost per turn" value={formatCost(stats.averageCostUsd)} />
      ) : null}
    </Section>
  );
}
