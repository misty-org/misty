// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

/**
 * An entry's on/off switch. It writes the CLI's own config, so it affects every client. A
 * read-only source still shows its real state, dimmed and not clickable, with the reason on hover.
 */
import { Power, PowerOff } from "lucide-react";
import { cn, IconButton } from "@/shared/ui";
import { copy, readonlyReasonText } from "./copy";
import type { McpConfigEntry } from "./types";

/** The row's on/off switch: always shows the real state; read-only sources are dimmed with the reason on hover. */
export function EnableToggle({
  entry,
  pending,
  onChange,
}: {
  entry: McpConfigEntry;
  pending: boolean;
  onChange: (enabled: boolean) => void;
}) {
  const readonlyReason = entry.writable ? null : readonlyReasonText(entry);
  const Icon = entry.enabled ? Power : PowerOff;
  return (
    <IconButton
      label={copy.toggle(entry.name)}
      aria-pressed={entry.enabled}
      // aria-disabled rather than disabled: a disabled button gets no hover, so no reason shows.
      aria-disabled={readonlyReason !== null || undefined}
      hint={
        readonlyReason ??
        (entry.enabled ? copy.enableHintOn(entry.name) : copy.enableHintOff(entry.name))
      }
      disabled={pending}
      onClick={readonlyReason !== null ? undefined : () => onChange(!entry.enabled)}
      className={cn(
        entry.enabled ? "text-cream-bright" : "text-cream-muted",
        readonlyReason !== null && "cursor-not-allowed opacity-40",
      )}
    >
      <Icon className="size-3.5" aria-hidden />
    </IconButton>
  );
}
