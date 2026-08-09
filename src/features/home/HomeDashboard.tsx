import {
  activityTargetHref,
  unreadActivityCountForSpace,
  useActivityStore,
  type ActivityItem,
} from "@/features/activity";
import { useAuth } from "@/features/auth";
import { SpaceAvatar } from "@/features/spaces";
import type { Space } from "@/services/spaces/dto/interfaces/types";
import { Button, Card, CardContent, CardHeader, CardTitle, Skeleton } from "@/shared/ui";
import {
  AtSign,
  Bell,
  Bot,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  Clock3,
  ListChecks,
  Mail,
  MessageCircle,
  RefreshCcw,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useHomeDashboardData, type HomeAgendaItem } from "./useHomeDashboardData";

const spaceCardClass = [
  "h-full min-h-[112px] gap-3 border-charcoal-border bg-charcoal-card/80 transition-colors",
  "group-hover:border-charcoal-active group-focus-visible:ring-2",
  "group-focus-visible:ring-charcoal-active",
].join(" ");
const retryStripClass = [
  "flex w-full items-center justify-center gap-1.5 border-t border-charcoal-border/60",
  "px-4 py-2 text-[11px] text-cream-muted hover:text-cream",
].join(" ");
const agendaRowClass = [
  "grid min-h-[58px] grid-cols-[66px_minmax(0,1fr)_auto] items-center gap-3",
  "border-b border-charcoal-border/60 px-5 py-2.5 transition-colors",
  "last:border-b-0 hover:bg-charcoal-hover/55",
].join(" ");
const importantRowClass = [
  "grid min-h-[58px] grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3",
  "border-b border-charcoal-border/60 px-5 py-2.5 text-left transition-colors",
  "last:border-b-0 hover:bg-charcoal-hover/55",
].join(" ");
const homeContentClass = [
  "mx-auto flex min-h-full w-full max-w-[1240px] flex-col gap-8",
  "px-[clamp(20px,4.5vw,64px)] pb-[clamp(28px,4vh,48px)]",
  "pt-[clamp(28px,4.5vh,52px)]",
].join(" ");

export function HomeDashboard() {
  const { user } = useAuth();
  const accountId = user?.id ?? "";
  const name = firstName(user?.name || user?.email || "there");
  const data = useHomeDashboardData(accountId);
  const activityItems = useActivityStore((state) => state.allItems);
  const attentionItems = useActivityStore((state) => state.attentionItems);
  const openActivityItem = useActivityStore((state) => state.openItem);
  const importantItems = useMemo(
    () => attentionItems.filter((item) => item.accountId === accountId).slice(0, 4),
    [accountId, attentionItems],
  );
  const inboxCountBySpace = useMemo(() => {
    const counts = new Map<string, number>();
    for (const space of data.spaces) {
      const count = unreadActivityCountForSpace(activityItems, space.id);
      if (count > 0) counts.set(space.id, count);
    }
    return counts;
  }, [activityItems, data.spaces]);

  return (
    <div className="relative h-full min-h-0 overflow-hidden bg-charcoal-bg">
      <div className="h-full min-h-0 overflow-y-auto">
        <div className={homeContentClass}>
          <header>
            <p className="text-sm text-cream-muted">{formatFullDate(new Date())}</p>
            <h1 className="mt-2 text-[clamp(30px,3.2vw,44px)] font-semibold tracking-[-0.035em] text-cream-bright">
              Good {dayPart()}, {name}
            </h1>
          </header>

          <section aria-labelledby="your-spaces-heading" className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <h2 id="your-spaces-heading" className="text-base font-semibold text-cream-bright">
                Your Spaces
              </h2>
              <Link
                to="/spaces"
                className="text-xs text-cream-muted transition-colors hover:text-cream"
              >
                Manage
              </Link>
            </div>
            {data.loading && !data.snapshotReady ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {[0, 1, 2, 3].map((item) => (
                  <Skeleton key={item} className="h-[112px] rounded-xl bg-charcoal-card" />
                ))}
              </div>
            ) : data.spaces.length ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {data.spaces.slice(0, 4).map((space) => (
                  <SpaceCard
                    key={space.id}
                    space={space}
                    unreadCount={inboxCountBySpace.get(space.id) ?? 0}
                  />
                ))}
              </div>
            ) : (
              <Card size="sm" className="border-dashed bg-charcoal-card/60">
                <CardContent className="flex items-center justify-between gap-4">
                  <span className="text-sm text-cream-muted">
                    Create a Space to start working together.
                  </span>
                  <Button asChild size="sm">
                    <Link to="/spaces?createSpace=1">Create Space</Link>
                  </Button>
                </CardContent>
              </Card>
            )}
          </section>

          <div className="grid gap-4 md:grid-cols-2">
            <TodayCard
              items={data.agenda}
              loading={data.agendaLoading}
              failures={data.agendaFailures}
              onRetry={() => void data.refreshAgenda()}
            />
            <ImportantCard items={importantItems} onOpen={openActivityItem} />
          </div>

          {data.error && !data.snapshotReady ? (
            <div className="flex items-center justify-between rounded-lg border border-charcoal-border bg-charcoal-card px-4 py-3 text-sm text-cream-muted">
              <span>Home couldn’t refresh.</span>
              <Button variant="ghost" size="sm" onClick={() => void data.refresh()}>
                <RefreshCcw className="size-4" />
                Retry
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ImportantCard(props: { items: ActivityItem[]; onOpen: (id: string) => unknown }) {
  return (
    <Card className="min-h-[292px] gap-0 bg-charcoal-card/70 py-0">
      <CardHeader className="flex flex-row items-center justify-between border-b border-charcoal-border/70 px-5 py-4">
        <CardTitle className="text-base font-semibold text-cream-bright">Important</CardTitle>
        <Bell className="size-4 text-cream-muted" strokeWidth={1.8} />
      </CardHeader>
      <CardContent className="px-0">
        {props.items.length ? (
          props.items.map((item) => (
            <ImportantRow key={item.id} item={item} onOpen={() => props.onOpen(item.id)} />
          ))
        ) : (
          <QuietEmpty icon={Bell} text="You’re all caught up." />
        )}
      </CardContent>
    </Card>
  );
}

function ImportantRow(props: { item: ActivityItem; onOpen: () => unknown }) {
  const Icon = importantIcon(props.item.kind);
  const href = activityTargetHref(props.item.target);
  const content = (
    <>
      <span className="grid size-8 place-items-center rounded-lg bg-charcoal-hover text-cream-muted">
        <Icon className="size-4" strokeWidth={1.8} />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-cream">{props.item.title}</span>
        {props.item.body ? (
          <span className="block truncate text-xs text-cream-muted">{props.item.body}</span>
        ) : null}
      </span>
      <span className="whitespace-nowrap text-[11px] text-cream-muted">
        {formatRelative(props.item.createdAt)}
      </span>
    </>
  );

  return href ? (
    <Link to={href} className={importantRowClass} onClick={props.onOpen}>
      {content}
    </Link>
  ) : (
    <button type="button" className={`${importantRowClass} w-full`} onClick={props.onOpen}>
      {content}
    </button>
  );
}

function importantIcon(kind: ActivityItem["kind"]): LucideIcon {
  if (kind === "mention") return AtSign;
  if (kind === "reply" || kind === "message") return MessageCircle;
  if (kind === "invitation") return Mail;
  if (kind === "approval" || kind === "completion") return CheckCircle2;
  if (kind === "failure") return CircleAlert;
  if (kind === "agent" || kind === "workflow") return Bot;
  return Bell;
}

function SpaceCard(props: { space: Space; unreadCount: number }) {
  return (
    <Link to={`/spaces/${encodeURIComponent(props.space.id)}`} className="group outline-none">
      <Card size="sm" className={spaceCardClass}>
        <CardHeader className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
          <SpaceAvatar space={props.space} className="size-10 ring-1 ring-charcoal-border" />
          <div className="min-w-0">
            <CardTitle className="truncate text-sm text-cream-bright">{props.space.name}</CardTitle>
            <p className="mt-0.5 truncate text-xs text-cream-muted">
              Updated {formatRelative(props.space.updated_at)}
            </p>
          </div>
          {props.unreadCount ? (
            <span className="grid min-w-5 place-items-center rounded-full bg-cream px-1.5 py-0.5 text-[10px] font-semibold text-charcoal-bg">
              {Math.min(props.unreadCount, 99)}
            </span>
          ) : null}
        </CardHeader>
        <CardContent className="flex items-center gap-1.5 text-xs text-cream-muted">
          <Users className="size-3.5" strokeWidth={1.8} />
          {props.space.member_count} member{props.space.member_count === 1 ? "" : "s"}
        </CardContent>
      </Card>
    </Link>
  );
}

function TodayCard(props: {
  items: HomeAgendaItem[];
  loading: boolean;
  failures: number;
  onRetry: () => void;
}) {
  return (
    <Card className="min-h-[292px] gap-0 bg-charcoal-card/70 py-0">
      <CardHeader className="flex flex-row items-center justify-between border-b border-charcoal-border/70 px-5 py-4">
        <CardTitle className="text-base font-semibold text-cream-bright">Today</CardTitle>
        <CalendarDays className="size-4 text-cream-muted" strokeWidth={1.8} />
      </CardHeader>
      <CardContent className="px-0">
        {props.loading && !props.items.length ? (
          <RowsSkeleton />
        ) : props.items.length ? (
          props.items
            .slice(0, 4)
            .map((item) => (
              <AgendaRow key={`${item.spaceId}:${item.kind}:${item.id}`} item={item} />
            ))
        ) : (
          <QuietEmpty icon={CalendarDays} text="Nothing scheduled today." />
        )}
        {props.failures ? (
          <button type="button" onClick={props.onRetry} className={retryStripClass}>
            <RefreshCcw className="size-3" /> Some Spaces couldn’t refresh
          </button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function AgendaRow({ item }: { item: HomeAgendaItem }) {
  const href =
    item.kind === "task" && item.task_id
      ? `/spaces/${encodeURIComponent(item.spaceId)}/planner/tasks/board?task=${encodeURIComponent(item.task_id)}`
      : `/spaces/${encodeURIComponent(item.spaceId)}/planner/agenda/day?date=${item.starts_at.slice(0, 10)}`;
  return (
    <Link to={href} className={agendaRowClass}>
      <span className="text-xs tabular-nums text-cream-muted">
        {item.all_day ? "All day" : formatTime(item.starts_at)}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-cream">{item.title}</span>
        <span className="block truncate text-xs text-cream-muted">{item.spaceName}</span>
      </span>
      {item.kind === "task" ? (
        <ListChecks className="size-4 text-cream-muted" />
      ) : (
        <Clock3 className="size-4 text-cream-muted" />
      )}
    </Link>
  );
}

function RowsSkeleton() {
  return (
    <div className="space-y-px">
      {[0, 1, 2].map((item) => (
        <div
          key={item}
          className="flex h-[64px] items-center gap-3 border-b border-charcoal-border/60 px-5"
        >
          <Skeleton className="size-8 rounded-lg" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      ))}
    </div>
  );
}

function QuietEmpty({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <div className="grid min-h-[220px] place-items-center text-center">
      <div>
        <Icon className="mx-auto size-5 text-cream-muted" strokeWidth={1.7} />
        <p className="mt-2 text-sm text-cream-muted">{text}</p>
      </div>
    </div>
  );
}

function firstName(value: string): string {
  return value.trim().split(/\s+/)[0] || "there";
}
function dayPart(): string {
  const hour = new Date().getHours();
  return hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
}
function formatFullDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(date);
}
function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(
    new Date(value),
  );
}
function formatRelative(value: string): string {
  const elapsed = Math.max(0, Date.now() - Date.parse(value));
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
