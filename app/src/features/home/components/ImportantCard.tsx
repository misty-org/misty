import { activityTargetHref, type ActivityItem } from "@/features/activity";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@/shared/ui";
import {
  AtSign,
  Bell,
  Bot,
  CheckCircle2,
  CircleAlert,
  Mail,
  MessageCircle,
  X,
  type LucideIcon,
} from "lucide-react";
import { Link } from "react-router-dom";
import { formatRelative } from "../homeFormat";

const rowClass = [
  "grid min-h-[58px] grid-cols-[32px_minmax(0,1fr)_auto_auto] items-center gap-3",
  "border-b border-charcoal-border/60 px-5 py-2.5 text-left transition-colors",
  "last:border-b-0 hover:bg-charcoal-hover/55",
].join(" ");

export function ImportantCard(props: {
  items: ActivityItem[];
  onOpen: (id: string) => unknown;
  onDismiss: (id: string) => void;
  onDismissAll: () => void;
}) {
  return (
    <Card className="min-h-[292px] gap-0 bg-charcoal-card/70 py-0">
      <CardHeader className="flex flex-row items-center justify-between border-b border-charcoal-border/70 px-5 py-4">
        <CardTitle className="text-base font-semibold text-cream-bright">Important</CardTitle>
        {props.items.length ? (
          <Button
            variant="ghost"
            size="sm"
            type="button"
            className="h-7 px-2 text-xs text-cream-muted hover:text-cream"
            onClick={props.onDismissAll}
          >
            Clear all
          </Button>
        ) : (
          <Bell className="size-4 text-cream-muted" strokeWidth={1.8} />
        )}
      </CardHeader>
      <CardContent className="px-0">
        {props.items.length ? (
          props.items.map((item) => (
            <ImportantRow
              key={item.id}
              item={item}
              onOpen={() => props.onOpen(item.id)}
              onDismiss={() => props.onDismiss(item.id)}
            />
          ))
        ) : (
          <div className="grid min-h-[220px] place-items-center px-5 text-center">
            <p className="text-sm text-cream-muted">You’re all caught up.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ImportantRow(props: { item: ActivityItem; onOpen: () => unknown; onDismiss: () => void }) {
  const Icon = importantIcon(props.item.kind);
  const href = activityTargetHref(props.item.target);
  const body = (
    <>
      <span className="grid size-8 place-items-center rounded-lg bg-charcoal-bg text-cream-muted">
        <Icon className="size-4" strokeWidth={1.8} />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-cream">{props.item.title}</span>
        <span className="block truncate text-xs text-cream-muted">{props.item.body}</span>
      </span>
      <span className="text-xs tabular-nums text-cream-muted">
        {formatRelative(props.item.createdAt)}
      </span>
    </>
  );

  return (
    <div className={rowClass}>
      {href ? (
        <Link
          to={href}
          onClick={props.onOpen}
          className="col-span-3 grid grid-cols-subgrid items-center gap-3"
        >
          {body}
        </Link>
      ) : (
        <button
          type="button"
          onClick={props.onOpen}
          className="col-span-3 grid grid-cols-subgrid items-center gap-3 text-left"
        >
          {body}
        </button>
      )}
      <Button
        variant="ghost"
        size="icon"
        type="button"
        className="size-7 shrink-0 text-cream-muted hover:text-cream"
        aria-label={`Dismiss ${props.item.title}`}
        title="Dismiss"
        onClick={props.onDismiss}
      >
        <X className="size-3.5" strokeWidth={2} />
      </Button>
    </div>
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
