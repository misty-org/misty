import { memo, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCheck, ChevronDown, Filter, Search, Trash2, X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { Button, Input, Popover, PopoverContent, PopoverTrigger } from "@/ui";
import { useExplorerStore } from "@/stores/explorer";
import { useSpacesStore } from "@/stores/spaces/useSpacesStore";
import type { SpaceInboxItem } from "@/models/interfaces/features/spaces/types";
import { initialsForProfile } from "./helpers";

/**
 * Full-surface activity feed presented as an overlay (see ActivityOverlay).
 *
 * The reference timeline — avatar, "actor verb target", a detail line, relative
 * time, day grouping, connector line, and a summary footer — is built from the
 * activity data we currently have (Spaces inbox sender + preview, and local
 * Explorer notifications). Richer per-item detail (e.g. field-level diffs) and
 * real avatars would need a dedicated workspace-events feed on the backend.
 */
type FeedKind = "mention" | "message" | "local";

interface FeedEntry {
  id: string;
  actor: string;
  verb: string;
  target: string;
  detail: string;
  timestampMs: number;
  kind: FeedKind;
  onOpen?: () => void;
}

const KIND_FILTERS: Array<{ value: FeedKind; label: string }> = [
  { value: "mention", label: "Mentions" },
  { value: "message", label: "Messages" },
  { value: "local", label: "This device" },
];

const PAGE_SIZE = 20;

export const ActivityFeed = memo(function ActivityFeed(props: { onClose: () => void }) {
  const navigate = useNavigate();
  const { history, clearHistory, markRead } = useExplorerStore(
    useShallow((state) => ({
      history: state.notificationHistory,
      clearHistory: state.clearNotificationHistory,
      markRead: state.markNotificationsRead,
    })),
  );
  const { inbox, loadInbox, markInboxSeen, clearInbox } = useSpacesStore(
    useShallow((state) => ({
      inbox: state.inbox,
      loadInbox: state.loadInbox,
      markInboxSeen: state.markInboxSeen,
      clearInbox: state.clearInbox,
    })),
  );

  const [search, setSearch] = useState("");
  const [kindFilters, setKindFilters] = useState<Set<FeedKind>>(new Set());
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  useEffect(() => {
    markRead();
    void markInboxSeen().then(loadInbox);
  }, [loadInbox, markInboxSeen, markRead]);

  const entries = useMemo(
    () => buildFeedEntries(inbox, history, navigate, props.onClose),
    [history, inbox, navigate, props.onClose],
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return entries.filter((entry) => {
      if (kindFilters.size > 0 && !kindFilters.has(entry.kind)) return false;
      if (!needle) return true;
      return `${entry.actor} ${entry.verb} ${entry.target} ${entry.detail}`
        .toLowerCase()
        .includes(needle);
    });
  }, [entries, kindFilters, search]);

  const stats = useMemo(() => computeStats(entries), [entries]);
  const visible = filtered.slice(0, visibleCount);
  const groups = useMemo(() => groupByDay(visible), [visible]);
  const hasMore = filtered.length > visible.length;
  const hasEntries = entries.length > 0;

  const toggleKind = (value: FeedKind) => {
    setVisibleCount(PAGE_SIZE);
    setKindFilters((current) => {
      const next = new Set(current);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  };

  const clearAll = () => {
    clearHistory();
    void clearInbox("unreads");
    void clearInbox("mentions");
  };

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] bg-charcoal-bg text-cream">
      <header className="flex items-center justify-between gap-4 border-b border-charcoal-border px-5 py-4">
        <div className="min-w-0">
          <h2 className="m-0 text-lg font-semibold leading-tight">Activity</h2>
          <p className="mt-0.5 text-sm text-cream-muted">Track changes across Files and Spaces</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative hidden sm:block">
            <Search
              size={15}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-cream-muted"
            />
            <Input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setVisibleCount(PAGE_SIZE);
              }}
              placeholder="Search activity"
              aria-label="Search activity"
              className="h-9 w-56 pl-8"
            />
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 gap-1.5">
                <Filter size={15} />
                Filter
                {kindFilters.size > 0 ? (
                  <span className="ml-0.5 rounded-full bg-charcoal-active px-1.5 text-[10px] font-semibold text-cream">
                    {kindFilters.size}
                  </span>
                ) : null}
                <ChevronDown size={13} className="text-cream-muted" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-52 p-1.5">
              <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-cream-muted">
                Type
              </p>
              {KIND_FILTERS.map((option) => {
                const active = kindFilters.has(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => toggleKind(option.value)}
                    className={[
                      "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5",
                      "text-left text-sm text-cream transition-colors hover:bg-charcoal-hover",
                    ].join(" ")}
                  >
                    {option.label}
                    <span
                      className={[
                        "grid size-4 place-items-center rounded-[4px] border",
                        active
                          ? "border-charcoal-active bg-charcoal-active text-cream-bright"
                          : "border-charcoal-border",
                      ].join(" ")}
                    >
                      {active ? <CheckCheck size={11} strokeWidth={3} /> : null}
                    </span>
                  </button>
                );
              })}
              {kindFilters.size > 0 ? (
                <button
                  type="button"
                  onClick={() => setKindFilters(new Set())}
                  className="mt-1 w-full rounded-md px-2 py-1.5 text-left text-xs text-cream-muted transition-colors hover:bg-charcoal-hover hover:text-cream"
                >
                  Clear filters
                </button>
              ) : null}
            </PopoverContent>
          </Popover>
          <Button
            variant="ghost"
            size="icon"
            className="size-9"
            onClick={clearAll}
            disabled={!hasEntries}
            aria-label="Clear all activity"
            title="Clear all activity"
          >
            <Trash2 size={16} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-9"
            onClick={props.onClose}
            aria-label="Close activity"
          >
            <X size={16} />
          </Button>
        </div>
      </header>

      <div className="min-h-0 overflow-auto">
        <div className="mx-auto max-w-2xl px-5 py-4">
          {groups.length > 0 ? (
            groups.map((group) => (
              <section key={group.label} className="mb-2">
                <h3 className="sticky top-0 z-10 -mx-5 bg-charcoal-bg px-5 py-2 text-xs font-semibold text-cream-muted ">
                  {group.label}
                </h3>
                <ol className="m-0 list-none p-0">
                  {group.entries.map((entry, index) => (
                    <FeedRow
                      key={entry.id}
                      entry={entry}
                      last={index === group.entries.length - 1}
                    />
                  ))}
                </ol>
              </section>
            ))
          ) : (
            <div className="grid place-items-center gap-2 py-20 text-center">
              <h3 className="m-0 text-base font-semibold text-cream">
                {hasEntries ? "No matching activity" : "You’re all caught up"}
              </h3>
              <p className="m-0 max-w-xs text-sm text-cream-muted">
                {hasEntries
                  ? "Try a different search or clear the filters."
                  : "Workspace changes and mentions will show up here as they happen."}
              </p>
            </div>
          )}
          {hasMore ? (
            <div className="flex justify-center py-2">
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-cream-muted"
                onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
              >
                <ChevronDown size={15} />
                Load more
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      <footer className="flex items-center gap-2 border-t border-charcoal-border px-5 py-3 text-xs text-cream-muted">
        <Stat label="Today" value={stats.today} />
        <Dot />
        <Stat label="This week" value={stats.week} />
        <Dot />
        <Stat label="This month" value={stats.month} />
      </footer>
    </div>
  );
});

function FeedRow(props: { entry: FeedEntry; last: boolean }) {
  const { entry } = props;
  const interactive = Boolean(entry.onOpen);
  const Row = interactive ? "button" : "div";
  return (
    <li className="relative">
      {!props.last ? (
        <span
          aria-hidden="true"
          className="absolute left-5 top-11 -bottom-1 w-px -translate-x-1/2 bg-charcoal-border"
        />
      ) : null}
      <Row
        type={interactive ? "button" : undefined}
        onClick={entry.onOpen}
        className={[
          "grid w-full grid-cols-[40px_minmax(0,1fr)] items-start gap-3 rounded-lg px-1 py-2.5 text-left",
          interactive ? "transition-colors hover:bg-charcoal-hover" : "",
        ].join(" ")}
      >
        <span className="grid size-10 place-items-center rounded-full bg-charcoal-card text-xs font-semibold text-cream inset-ring-1 inset-ring-charcoal-border">
          {initialsForProfile(entry.actor, "")}
        </span>
        <span className="min-w-0">
          <span className="block leading-snug [overflow-wrap:anywhere]">
            <span className="font-semibold text-cream">{entry.actor}</span>
            {entry.verb ? <span className="text-cream-muted"> {entry.verb} </span> : " "}
            {entry.target ? <span className="font-semibold text-cream">{entry.target}</span> : null}
          </span>
          {entry.detail ? (
            <span className="mt-0.5 block text-sm text-cream-muted [overflow-wrap:anywhere]">
              {entry.detail}
            </span>
          ) : null}
          <span className="mt-0.5 block text-xs text-cream-muted">
            {formatRelative(entry.timestampMs)}
          </span>
        </span>
      </Row>
    </li>
  );
}

function Stat(props: { label: string; value: number }) {
  return (
    <span>
      {props.label} <span className="font-semibold text-cream">{props.value}</span>
    </span>
  );
}

function Dot() {
  return <span className="text-cream-muted/50">•</span>;
}

function buildFeedEntries(
  inbox: { unreads: SpaceInboxItem[]; mentions: SpaceInboxItem[] },
  history: Array<{ id: number; message: string; createdAtMs: number }>,
  navigate: (path: string) => void,
  onClose: () => void,
): FeedEntry[] {
  const cloudById = new Map<number, SpaceInboxItem>();
  for (const item of [...inbox.unreads, ...inbox.mentions]) cloudById.set(item.id, item);
  const cloud = [...cloudById.values()].map<FeedEntry>((item) => {
    const sender = typeof item.payload.sender_name === "string" ? item.payload.sender_name : "";
    const preview = typeof item.payload.preview === "string" ? item.payload.preview : "";
    const kind: FeedKind = item.kind === "mention" ? "mention" : "message";
    return {
      id: `cloud-${item.id}`,
      actor: sender || "Someone",
      verb: verbForKind(kind),
      target: item.space_name,
      detail: preview,
      timestampMs: new Date(item.created_at).getTime(),
      kind,
      onOpen: () => {
        navigate(
          `/spaces/${encodeURIComponent(item.space_id)}/chat${item.message_id ? `?message=${encodeURIComponent(item.message_id)}` : ""}`,
        );
        onClose();
      },
    };
  });

  const local = history.map<FeedEntry>((item) => ({
    id: `local-${item.id}`,
    actor: "Misty",
    verb: "",
    target: item.message,
    detail: "",
    timestampMs: item.createdAtMs,
    kind: "local",
  }));

  return [...cloud, ...local].sort((left, right) => right.timestampMs - left.timestampMs);
}

function verbForKind(kind: FeedKind): string {
  switch (kind) {
    case "mention":
      return "mentioned you in";
    case "message":
      return "posted in";
    default:
      return "";
  }
}

function computeStats(entries: FeedEntry[]): { today: number; week: number; month: number } {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const weekAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  const monthAgo = now.getTime() - 30 * 24 * 60 * 60 * 1000;
  let today = 0;
  let week = 0;
  let month = 0;
  for (const entry of entries) {
    if (entry.timestampMs >= startOfToday) today += 1;
    if (entry.timestampMs >= weekAgo) week += 1;
    if (entry.timestampMs >= monthAgo) month += 1;
  }
  return { today, week, month };
}

function groupByDay(entries: FeedEntry[]): Array<{ label: string; entries: FeedEntry[] }> {
  const groups: Array<{ label: string; entries: FeedEntry[] }> = [];
  const byLabel = new Map<string, FeedEntry[]>();
  for (const entry of entries) {
    const label = dayLabel(entry.timestampMs);
    let bucket = byLabel.get(label);
    if (!bucket) {
      bucket = [];
      byLabel.set(label, bucket);
      groups.push({ label, entries: bucket });
    }
    bucket.push(entry);
  }
  return groups;
}

function dayLabel(timestampMs: number): string {
  const date = new Date(timestampMs);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayMs = 24 * 60 * 60 * 1000;
  const diffDays = Math.floor((startOfToday.getTime() - startOfDay(date)) / dayMs);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function formatRelative(timestampMs: number): string {
  if (!timestampMs) return "";
  const diff = Date.now() - timestampMs;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "just now";
  if (diff < hour) {
    const value = Math.round(diff / minute);
    return `${value} ${value === 1 ? "minute" : "minutes"} ago`;
  }
  if (diff < day) {
    const value = Math.round(diff / hour);
    return `${value} ${value === 1 ? "hour" : "hours"} ago`;
  }
  const value = Math.round(diff / day);
  if (value <= 7) return `${value} ${value === 1 ? "day" : "days"} ago`;
  return new Date(timestampMs).toLocaleDateString([], { month: "short", day: "numeric" });
}
