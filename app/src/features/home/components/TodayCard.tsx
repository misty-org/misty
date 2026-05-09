import { Button, Card, CardContent, CardHeader, CardTitle, Skeleton, cn } from "@/shared/ui";
import { CalendarDays, Check, Clock3, ListChecks, Plus, RefreshCcw } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { formatTime } from "../homeFormat";
import type { HomeAgendaItem } from "../useHomeDashboardData";

const rowClass = [
  "grid min-h-[58px] grid-cols-[66px_minmax(0,1fr)_auto] items-center gap-3",
  "border-b border-charcoal-border/60 px-5 py-2.5 transition-colors",
  "last:border-b-0 hover:bg-charcoal-hover/55",
].join(" ");
const retryStripClass = [
  "flex w-full items-center justify-center gap-1.5 border-t border-charcoal-border/60",
  "px-4 py-2 text-[11px] text-cream-muted hover:text-cream",
].join(" ");

export function TodayCard(props: {
  items: HomeAgendaItem[];
  loading: boolean;
  failures: number;
  quickAddSpaceId: string;
  pending: Set<string>;
  error: string | null;
  onRetry: () => void;
  onComplete: (spaceId: string, taskId: string) => void;
  onAdd: (spaceId: string, title: string) => void;
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
              <AgendaRow
                key={`${item.spaceId}:${item.kind}:${item.id}`}
                item={item}
                busy={item.task_id ? props.pending.has(item.task_id) : false}
                onComplete={props.onComplete}
              />
            ))
        ) : (
          <div className="grid min-h-[176px] place-items-center px-5 text-center">
            <p className="text-sm text-cream-muted">Nothing scheduled today.</p>
          </div>
        )}
        {props.quickAddSpaceId ? (
          <QuickAdd
            busy={props.pending.has("new")}
            onAdd={(title) => props.onAdd(props.quickAddSpaceId, title)}
          />
        ) : null}
        {props.error ? (
          <p className="border-t border-charcoal-border/60 px-5 py-2 text-[11px] text-cream-bright">
            {props.error}
          </p>
        ) : null}
        {props.failures ? (
          <button type="button" onClick={props.onRetry} className={retryStripClass}>
            <RefreshCcw className="size-3" /> Some Spaces couldn’t refresh
          </button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function AgendaRow(props: {
  item: HomeAgendaItem;
  busy: boolean;
  onComplete: (spaceId: string, taskId: string) => void;
}) {
  const { item } = props;
  const href =
    item.kind === "task" && item.task_id
      ? `/spaces/${encodeURIComponent(item.spaceId)}/planner/tasks/board?task=${encodeURIComponent(item.task_id)}`
      : `/spaces/${encodeURIComponent(item.spaceId)}/planner/agenda/day?date=${item.starts_at.slice(0, 10)}`;
  const done = item.status === "done";

  return (
    <div className={rowClass}>
      <span className="text-xs tabular-nums text-cream-muted">
        {item.all_day ? "All day" : formatTime(item.starts_at)}
      </span>
      <Link to={href} className="min-w-0">
        <span
          className={cn(
            "block truncate text-sm font-medium",
            done ? "text-cream-muted line-through" : "text-cream",
          )}
        >
          {item.title}
        </span>
        <span className="block truncate text-xs text-cream-muted">{item.spaceName}</span>
      </Link>
      {item.kind === "task" && item.task_id && !done ? (
        <Button
          variant="outline"
          size="icon"
          type="button"
          className="size-7 shrink-0 rounded-full border-charcoal-border text-cream-muted hover:text-cream-bright"
          aria-label={`Complete ${item.title}`}
          title="Mark complete"
          disabled={props.busy}
          onClick={() => props.onComplete(item.spaceId, item.task_id ?? "")}
        >
          <Check className="size-3.5" strokeWidth={2.4} />
        </Button>
      ) : item.kind === "task" ? (
        <ListChecks className="size-4 text-cream-muted" />
      ) : (
        <Clock3 className="size-4 text-cream-muted" />
      )}
    </div>
  );
}

function QuickAdd(props: { busy: boolean; onAdd: (title: string) => void }) {
  const [title, setTitle] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || props.busy) return;
    props.onAdd(title);
    setTitle("");
  };

  return (
    <form
      onSubmit={submit}
      className="flex items-center gap-2 border-t border-charcoal-border/60 px-5 py-2.5"
    >
      <Plus className="size-4 shrink-0 text-cream-muted" strokeWidth={1.8} />
      <input
        className="h-8 min-w-0 flex-1 border-0 bg-transparent text-sm text-cream outline-none placeholder:text-cream-muted"
        value={title}
        placeholder="Add a task for today"
        aria-label="Add a task for today"
        disabled={props.busy}
        onChange={(event) => setTitle(event.target.value)}
      />
    </form>
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
