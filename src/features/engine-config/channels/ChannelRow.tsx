// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

import { GripVertical, KeyRound, Pencil, Trash2 } from "lucide-react";
import { useMemo, type DragEvent, type ReactNode } from "react";
import {
  Avatar,
  AvatarFallback,
  Badge,
  cn,
  IconButton,
  OverflowFadeText,
  Pressable,
  Separator,
  Switch,
  Text,
  Tooltip,
} from "@/shared/ui";
import type { ProviderEntry } from "./providers";

export const ROW = "flex min-h-13 w-full items-center gap-3 border-b px-3 py-2.5 last:border-b-0";

export function Pill({ children }: { children: ReactNode }) {
  return <Badge variant="outline">{children}</Badge>;
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
function ChannelAvatar({ name }: { name: string }) {
  return (
    <Avatar shape="tile">
      <AvatarFallback>{name.charAt(0).toUpperCase() || "?"}</AvatarFallback>
    </Avatar>
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
      draggable={!busy}
      onDragStart={drag.onDragStart}
      onDragOver={drag.onDragOver}
      onDrop={drag.onDrop}
      className={cn(ROW, "relative", drag.dragging && "opacity-50")}
    >
      {/* The whole row makes the channel current; the controls sit above it. */}
      <Pressable
        wash="control"
        aria-label={`Use ${entry.name}`}
        className="absolute inset-0"
        onClick={() => {
          if (!busy && !current) onToggle(true);
        }}
      />
      <Text bare tone="muted" className="pointer-events-none relative flex shrink-0">
        <GripVertical aria-hidden />
      </Text>
      <span className="pointer-events-none relative flex shrink-0">
        <ChannelAvatar name={entry.name} />
      </span>
      <div className="pointer-events-none relative flex min-w-0 flex-1 flex-col">
        <Text bare as="p" tone="bright" className="flex items-center gap-1.5 text-sm">
          <OverflowFadeText full>{entry.name}</OverflowFadeText>
          {fromCcSwitch ? <Pill>CC Switch</Pill> : null}
          {entry.hasKey ? (
            <Tooltip content="Key saved in the keychain">
              <Text bare tone="muted" className="pointer-events-auto">
                <KeyRound aria-label="Key saved" />
              </Text>
            </Tooltip>
          ) : null}
        </Text>
        {subtitle ? (
          <Text as="p" tone="muted" full className="text-xs">
            {subtitle}
          </Text>
        ) : null}
      </div>
      <span className="relative" onClick={(event) => event.stopPropagation()}>
        <Switch
          aria-label={entry.name}
          checked={current}
          disabled={busy}
          onCheckedChange={onToggle}
        />
      </span>
      <Separator orientation="vertical" className="relative h-4" />
      <IconButton
        label="Edit"
        className="relative"
        disabled={busy}
        onClick={(event) => {
          event.stopPropagation();
          onEdit();
        }}
      >
        <Pencil />
      </IconButton>
      <IconButton
        label="Delete"
        className="relative"
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
