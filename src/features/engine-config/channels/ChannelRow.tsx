// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

import { KeyRound, Pencil, Trash2 } from "lucide-react";
import { useMemo, type DragEvent, type ReactNode } from "react";
import { Badge, ListRow, MenuItem, Switch, Text, Tooltip } from "@misty/ui";
import type { ProviderEntry } from "./providers";

export function Pill({ children }: { children: ReactNode }) {
  return <Badge variant="outline">{children}</Badge>;
}

function hostOf(url: string): string {
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).host;
  } catch {
    return url;
  }
}

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
      [
        entry.remark,
        [entry.model, entry.baseUrl && hostOf(entry.baseUrl)].filter(Boolean).join(" on "),
      ]
        .filter(Boolean)
        .join(", "),
    [entry.remark, entry.baseUrl, entry.model],
  );
  const badge =
    fromCcSwitch || entry.hasKey ? (
      <span className="flex items-center gap-1.5">
        {fromCcSwitch ? <Pill>CC Switch</Pill> : null}
        {entry.hasKey ? (
          <Tooltip content="Key saved in the keychain">
            <Text bare tone="muted" className="flex">
              <KeyRound aria-label="Key saved" />
            </Text>
          </Tooltip>
        ) : null}
      </span>
    ) : undefined;
  return (
    <ListRow
      label={entry.name}
      aria-label={`Use ${entry.name}`}
      description={subtitle || undefined}
      badge={badge}
      draggable={!busy}
      onDragStart={drag.onDragStart}
      onDragOver={drag.onDragOver}
      onDrop={drag.onDrop}
      className={drag.dragging ? "opacity-50" : undefined}
      onOpen={() => {
        if (!busy && !current) onToggle(true);
      }}
      trailing={
        <Switch
          aria-label={entry.name}
          checked={current}
          disabled={busy}
          onCheckedChange={onToggle}
        />
      }
      menuLabel={`Actions for ${entry.name}`}
      menu={
        <>
          <MenuItem icon={Pencil} label="Edit" disabled={busy} onSelect={onEdit} />
          <MenuItem
            icon={Trash2}
            label="Delete"
            danger
            disabled={busy || current}
            onSelect={() => {
              if (!current) onDelete();
            }}
          />
        </>
      }
    />
  );
}
