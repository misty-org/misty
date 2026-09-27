import { useState } from "react";
import { ArrowUpRight, Check, MoreHorizontal } from "lucide-react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  Pressable,
} from "@/shared/ui";
import { activityMuteKeys, isPendingRequest } from "./activityPolicy";
import type { ActivityItem } from "./types";

export function ActivityRow({
  item,
  muted,
  onOpen,
  onRead,
  onMute,
  onDismiss,
}: {
  item: ActivityItem;
  muted: string[];
  onOpen(): void;
  onRead(): void;
  onMute(key: string, muted: boolean): void;
  onDismiss(): void;
}) {
  const [expanded, setExpanded] = useState(false);
  const pending = isPendingRequest(item);
  const source = item.sourceLabel || item.appId || "Misty";
  const keys = activityMuteKeys(item);
  const status = item.resolvedAt
    ? "Resolved"
    : pending
      ? "Action needed"
      : item.kind === "completion"
        ? item.readAt
          ? "Completed · Read"
          : "Completed · Unread"
        : item.readAt
          ? "Read"
          : "Unread";
  const timestamp = item.updatedAt ?? item.createdAt;
  const date = new Date(timestamp);
  return (
    <li className="overflow-hidden rounded-xl border border-charcoal-border bg-charcoal-bg/50">
      <div className="flex items-center gap-2 px-3 pt-1">
        <div className="min-w-0 flex-1">
          <p className="m-0 truncate text-xs font-medium text-cream-bright" title={source}>
            {source}
          </p>
        </div>
        {item.target.kind !== "none" ? (
          <IconButton
            label={`Open destination for ${item.title}`}
            title="Open destination"
            onClick={onOpen}
          >
            <ArrowUpRight size={14} />
          </IconButton>
        ) : null}
        {!pending && !item.readAt ? (
          <IconButton label={`Mark update read: ${item.title}`} title="Mark read" onClick={onRead}>
            <Check size={15} aria-hidden="true" />
          </IconButton>
        ) : null}
        {keys.length || (item.dismissible && pending) ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton label={`Options for ${source}`} tooltip={false}>
                <MoreHorizontal size={14} />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {keys.map((key) => (
                <DropdownMenuItem key={key} onSelect={() => onMute(key, !muted.includes(key))}>
                  {muted.includes(key) ? "Unmute" : "Mute"}{" "}
                  {key.startsWith("space:") ? "Space" : "app"}
                </DropdownMenuItem>
              ))}
              {item.dismissible && pending ? (
                <DropdownMenuItem onSelect={onDismiss}>Dismiss notice</DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      <Pressable
        onClick={onOpen}
        className="rounded-md flex w-full items-start gap-2 px-3 py-2 hover:bg-charcoal-hover/50"
      >
        <span className="min-w-0 flex-1">
          <span className="mb-1 flex flex-wrap items-baseline gap-x-2 text-[11px] text-cream-muted">
            <span className={pending ? "font-medium text-cream-bright" : ""}>{status}</span>
            {Number.isFinite(date.getTime()) ? (
              <time dateTime={timestamp}>
                {new Intl.DateTimeFormat(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                }).format(date)}
              </time>
            ) : null}
          </span>
          <span className="block text-[13px] font-medium leading-5 text-cream-bright [overflow-wrap:anywhere]">
            {item.title}
          </span>
        </span>
      </Pressable>
      {item.body ? (
        <Button
          variant="ghost"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          title={expanded ? "Collapse details" : "Expand details"}
          className="block h-auto w-full px-3 pb-2 text-left text-xs leading-4 text-cream-muted hover:text-cream"
        >
          <span className={`${expanded ? "" : "line-clamp-1"} [overflow-wrap:anywhere]`}>
            {item.body}
          </span>
        </Button>
      ) : null}
    </li>
  );
}
