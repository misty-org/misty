import type { ReactNode } from "react";
import type { UnifiedNote } from "@/models/types/features/notes/types";

export interface NoteContextPanelProps {
  note?: UnifiedNote;
  spaces: { id: string; name: string }[];
  onAssignSpace?: (noteId: string, spaceId?: string, spaceName?: string) => void;
}

export interface ContextSectionProps {
  title: string;
  children: ReactNode;
}
