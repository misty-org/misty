// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

import { GripVertical, KeyRound, Pencil, Trash2 } from "lucide-react";
import { useMemo, type DragEvent, type ReactNode } from "react";
import { cn, Switch, IconButton, OverflowFadeText } from "@/shared/ui";
import type { ProviderEntry } from "./providers";

export const ROW =
  "flex min-h-[52px] w-full items-center gap-3 border-b border-charcoal-border px-3 py-2.5 last:border-b-0";

export function Pill({ children }: { children: ReactNode }) {
  return (
    <span
      className={[
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-sm border border-cream/10",
        "bg-charcoal-hover px-1.5 text-micro leading-none text-cream-muted",
      ].join(" ")}
    >
      {children}
    </span>
  );
}

/** host("https://api.moonshot.cn/anthropic") is "api.moonshot.cn". */
function hostOf(url: string): string {
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).host;
  } catch {
    return url;
  }
}

/** A neutral monogram for a channel. */
export function ChannelAvatar({ name }: { name: string }) {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-charcoal-card text-xs font-semibold text-cream">
      {name.charAt(0).toUpperCase() || "?"}
    </span>
  );
}

/** One saved channel. Clicking it makes it current; it can be dragged to reorder. */
export function ChannelRow({
  entry,
  current,
  busy,
  onToggle,
  onEdit,
  onDelete,
  drag,
}: {
  entry: ProviderEntry;
  current: boolean;
  busy: boolean;
  /** true makes it current; false (only while current) goes back to the CLI's own config. */
  onToggle: (on: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  drag: {
    onDragStart: (event: DragEvent) => void;
    onDragOver: (event: DragEvent) => void;
    onDrop: (event: DragEvent) => void;
    dragging: boolean;
  };
}) {
  const fromCcSwitch = (entry.raw as Record<string, unknown> | null)?.source === "cc-switch";
  const subtitle = useMemo(
    () =>
      [entry.remark, entry.baseUrl && hostOf(entry.baseUrl), entry.model]
        .filter(Boolean)
        .join(" · "),
    [entry.remark, entry.baseUrl, entry.model],
  );
  return (
    <div
      role="button"
      tabIndex={0}
      draggable={!busy}
      onDragStart={drag.onDragStart}
      onDragOver={drag.onDragOver}
      onDrop={drag.onDrop}
      className={cn(
        ROW,
        "cursor-pointer hover:bg-charcoal-hover/50",
        drag.dragging && "opacity-50",
      )}
      onClick={() => {
        if (!busy && !current) onToggle(true);
      }}
      onKeyDown={(event) => {
        // Keys from the switch and buttons inside handle themselves.
        if (event.target !== event.currentTarget) return;
        if ((event.key === "Enter" || event.key === " ") && !busy && !current) {
          event.preventDefault();
          onToggle(true);
        }
      }}
    >
      <GripVertical className="size-4 shrink-0 cursor-grab text-cream-muted" aria-hidden />
      <ChannelAvatar name={entry.name} />
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="flex items-center gap-1.5 text-sm text-cream-bright">
          <OverflowFadeText full>{entry.name}</OverflowFadeText>
          {fromCcSwitch ? <Pill>CC Switch</Pill> : null}
          {entry.hasKey ? (
            <span title="Key saved in the keychain" className="text-cream-muted">
              <KeyRound className="size-3.5" aria-label="Key saved" />
            </span>
          ) : null}
        </p>
        {subtitle ? (
          <OverflowFadeText as="p" full className="text-xs text-cream-muted">
            {subtitle}
          </OverflowFadeText>
        ) : null}
      </div>
      <span onClick={(event) => event.stopPropagation()}>
        <Switch
          aria-label={entry.name}
          checked={current}
          disabled={busy}
          onCheckedChange={onToggle}
        />
      </span>
      <span aria-hidden className="h-4 w-px shrink-0 bg-charcoal-border" />
      <IconButton
        size="sm"
        label="Edit"
        disabled={busy}
        onClick={(event) => {
          event.stopPropagation();
          onEdit();
        }}
      >
        <Pencil />
      </IconButton>
      <IconButton
        size="sm"
        label="Delete"
        disabled={busy || current}
        onClick={(event) => {
          event.stopPropagation();
          if (!current) onDelete();
        }}
      >
        <Trash2 />
      </IconButton>
    </div>
  );
}
