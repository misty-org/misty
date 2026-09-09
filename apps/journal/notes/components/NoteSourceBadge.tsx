import { StatusBadge, cn } from "@/shared/ui";
import type { StatusTone } from "@/shared/ui/model/types/status-badge";
import {
  AlertTriangle,
  CircleDot,
  Cloud,
  GitCompareArrows,
  PenLine,
  RefreshCw,
} from "lucide-react";
import { BrandIcon } from "../../../shared/BrandIcon";
import { brandIconAsset } from "../../../shared/brandIcons";
import type { NoteProviderStatus, NoteSource, NoteSyncStatus } from "../model/types/types";

export function NoteSourceIcon(props: NoteSourceIconProps) {
  const size = props.size ?? 14;
  return (
    <PenLine
      size={size}
      strokeWidth={1.9}
      className={cn("text-cream-bright", props.className)}
      aria-label={props.title}
      aria-hidden={props.title ? undefined : true}
    />
  );
}

export function NoteSourceBadge(props: NoteSourceBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded border border-charcoal-border/70 bg-charcoal-card",
        "px-1.5 py-0.5 text-[10px] font-medium text-cream-muted",
        props.className,
      )}
    >
      <NoteSourceIcon source={props.source} size={11} />
      Misty
    </span>
  );
}

const syncPresentation: Record<
  NoteSyncStatus,
  { tone: StatusTone; label: string; icon: typeof RefreshCw }
> = {
  synced: { tone: "neutral", label: "Synced", icon: CircleDot },
  syncing: { tone: "info", label: "Syncing", icon: RefreshCw },
  error: { tone: "warning", label: "Sync issue", icon: AlertTriangle },
  conflict: { tone: "info", label: "Newer in source", icon: GitCompareArrows },
  "local-only": { tone: "neutral", label: "Local only", icon: Cloud },
};

/** Deliberately quiet: even `error` reads as a warning, never a destructive red. */
export function NoteSyncIndicator(props: NoteSyncIndicatorProps) {
  if (props.status === "synced") return null;
  const { tone, label, icon: Icon } = syncPresentation[props.status];

  if (props.compact) {
    return (
      <span title={label} className={cn("inline-flex items-center", props.className)}>
        <Icon
          size={12}
          strokeWidth={2}
          className={cn(
            tone === "warning" && "text-sage-fg",
            tone === "info" && "text-cream-bright",
            tone === "neutral" && "text-cream-muted",
            props.status === "syncing" && "animate-spin",
          )}
        />
        <span className="sr-only">{label}</span>
      </span>
    );
  }

  return (
    <StatusBadge status={tone} className={cn("gap-1", props.className)}>
      <Icon
        size={11}
        strokeWidth={2}
        className={props.status === "syncing" ? "animate-spin" : ""}
      />
      {label}
    </StatusBadge>
  );
}

export const providerStatusPresentation: Record<
  NoteProviderStatus,
  { tone: StatusTone; label: string }
> = {
  connected: { tone: "success", label: "Connected" },
  syncing: { tone: "info", label: "Syncing" },
  needs_reconnect: { tone: "warning", label: "Needs reconnect" },
  error: { tone: "warning", label: "Sync issue" },
  disconnected: { tone: "neutral", label: "Not connected" },
};

/** Note connections share their artwork with navigation and the integration directory. */
export function ProviderGlyph(props: ProviderGlyphProps) {
  const size = props.size ?? 16;
  if (brandIconAsset(props.providerId))
    return <BrandIcon brand={props.providerId} size={size} className={props.className} />;
  return <PenLine size={size} strokeWidth={1.9} className={cn("text-cream-bright", props.className)} />;
}

export interface NoteSourceIconProps {
  source: NoteSource;
  size?: number;
  className?: string;
  title?: string;
}

export interface NoteSourceBadgeProps {
  source: NoteSource;
  className?: string;
}

export interface NoteSyncIndicatorProps {
  status: NoteSyncStatus;
  /** Compact renders a dot-only chip for dense list rows. */
  compact?: boolean;
  className?: string;
}

export interface ProviderGlyphProps {
  providerId: string;
  size?: number;
  className?: string;
}
