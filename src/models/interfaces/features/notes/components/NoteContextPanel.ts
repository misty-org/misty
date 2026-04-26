import type { ReactNode } from "react";
import type { UnifiedNote } from "@/models/types/features/notes/types";

export interface NoteContextPanelProps {
  note?: UnifiedNote;
}

export interface ContextSectionProps {
  title: string;
  children: ReactNode;
}
