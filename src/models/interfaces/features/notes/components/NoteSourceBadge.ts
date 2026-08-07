import type { NoteSource, NoteSyncStatus } from "@/models/types/features/notes/types";

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
