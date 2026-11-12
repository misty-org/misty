// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

/**
 * An entry's two switches:
 *
 * - On/off writes the CLI's own config, so it affects every client. A read-only source still
 *   shows its real state, dimmed and not clickable, with the reason on hover.
 * - How it starts writes only Misty's own device setting and affects only the engines Misty
 *   starts. On demand, the engine still gets the tool list (from the cache) and the real server
 *   starts on the first call.
 *
 * On a row both are icon buttons, their state in aria-pressed and the hover text; the details
 * dialog keeps a switch with its explanation. Entries that are off or not stdio can't go on
 * demand: the icon is dimmed but still hovers and focuses to read the reason, and when the whole
 * engine can't, it takes no room. An entry already on demand can always go back (the same rule as
 * the dialog's switch and native `write_mode`).
 */
import { Hourglass, Power, PowerOff, Zap } from "lucide-react";
import { cn, IconButton, Switch } from "@/shared/ui";
import { copy, launchUnsupportedText, readonlyReasonText } from "./copy";
import type { McpConfigEntry, McpLaunchMode } from "./types";

export function isOnDemand(entry: McpConfigEntry): boolean {
  return entry.launchMode === "onDemand";
}

/** null when it can change; otherwise the reason it can't. */
export function launchModeBlockedReason(entry: McpConfigEntry): string | null {
  if (entry.launchModeUnsupported) return launchUnsupportedText(entry.launchModeUnsupported);
  if (!entry.enabled) return copy.launchDisabledEntry;
  return null;
}

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
      size="sm"
      label={copy.toggle(entry.name)}
      aria-pressed={entry.enabled}
      // aria-disabled rather than disabled: a disabled button gets no hover, so no reason shows.
      aria-disabled={readonlyReason !== null || undefined}
      tooltip={
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

/** The row's launch mode switch: a bolt starts with the session, an hourglass on demand. */
export function LaunchModeToggle({
  entry,
  pending,
  onChange,
}: {
  entry: McpConfigEntry;
  pending: boolean;
  onChange: (mode: McpLaunchMode) => void;
}) {
  const onDemand = isOnDemand(entry);
  // When the whole engine can't, every row is the same: take no room, the reason is in the details.
  if (entry.launchModeUnsupported === "engine" && !onDemand) return null;
  const blocked = launchModeBlockedReason(entry);
  // Only going on demand is blocked; going back to the session always works.
  const locked = blocked !== null && !onDemand;
  const Icon = onDemand ? Hourglass : Zap;
  return (
    <IconButton
      size="sm"
      label={copy.launchToggle(entry.name)}
      aria-pressed={onDemand}
      aria-disabled={locked || undefined}
      tooltip={
        locked
          ? (blocked ?? copy.launchToggle(entry.name))
          : onDemand
            ? copy.launchOnDemandHint(entry.name)
            : copy.launchEagerHint(entry.name)
      }
      disabled={pending}
      onClick={locked ? undefined : () => onChange(onDemand ? "eager" : "onDemand")}
      className={cn(locked && "cursor-not-allowed opacity-40")}
    >
      <Icon className="size-3.5" aria-hidden />
    </IconButton>
  );
}

/** The full row in the details dialog: the switch and its explanation. */
export function LaunchModeRow({
  entry,
  pending,
  onChange,
}: {
  entry: McpConfigEntry;
  pending: boolean;
  onChange: (mode: McpLaunchMode) => void;
}) {
  const blocked = launchModeBlockedReason(entry);
  return (
    // The explanation goes on hover, so nothing sits under the label.
    <div
      className="flex items-center justify-between gap-3 rounded-lg border border-charcoal-border px-3 py-2.5"
      title={blocked ?? copy.launchDescription}
    >
      <span className="text-sm font-medium text-cream-bright">{copy.launchTitle}</span>
      <Switch
        aria-label={copy.launchToggle(entry.name)}
        checked={isOnDemand(entry)}
        disabled={pending || (blocked !== null && !isOnDemand(entry))}
        onCheckedChange={(onDemand) => onChange(onDemand ? "onDemand" : "eager")}
      />
    </div>
  );
}
