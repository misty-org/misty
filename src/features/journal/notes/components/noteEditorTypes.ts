import type {
  AiContextReference,
  AiSelectionSnapshot,
  AiSurfaceAdapter,
} from "@/features/ai-surface/types";
import type { JournalImageLease } from "@/features/journal/journalAssets";
import type { ReactNode } from "react";
import type { NoteBodyFormat } from "../model/types";
import type { UploadNoteAssetInput } from "../noteAssets";
import type { NoteCollaborationSession } from "../noteCollaboration";

export type NoteEditorSession = Pick<
  NoteCollaborationSession,
  "key" | "doc" | "fragment" | "title" | "markdown" | "metadata"
> & {
  role: "creator" | "editor" | "viewer";
  provider: Pick<NoteCollaborationSession["provider"], "awareness" | "on" | "off" | "synced">;
};
export interface NoteEditorRuntime {
  useCollaborationRoom(
    spaceId: string,
    noteId: string,
  ): {
    session: NoteEditorSession | null;
    error: string | null;
    notice: string | null;
  };
  uploadAsset(input: UploadNoteAssetInput): Promise<string>;
  resolveAsset?(reference: string): Promise<JournalImageLease>;
  renderImagePicker(input: { onCancel(): void; onSelect(file: File): void }): ReactNode;
  renderAiRegistration(adapter: AiSurfaceAdapter | null): ReactNode;
  renderAiSelection(adapter: AiSurfaceAdapter | null, selection: NoteAiSelection): ReactNode;
  renderError(error: string, spaceId: string, noteId: string): ReactNode;
  reportError(error: unknown): void;
  openCitation(citation: Parameters<NonNullable<AiSurfaceAdapter["openCitation"]>>[0]): void;
}
export interface NoteBlockEditorProps {
  runtime: NoteEditorRuntime;
  editable: boolean;
  collaborative?: boolean;
  noteId: string;
  accountId?: string;
  spaceId?: string;
  body: string;
  bodyFormat: NoteBodyFormat;
  bodyMarkdown?: string;
  autoFocus?: boolean;
  linkableNotes?: Array<{
    id: string;
    title: string;
  }>;
  onOpenNote?: (noteId: string) => void;
  aiContext?: AiContextReference;
}
export type NoteAiSelection = {
  snapshot: AiSelectionSnapshot;
  from: number;
  to: number;
  x: number;
  y: number;
};
