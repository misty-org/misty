import type { ComponentType } from "react";
import type { Misty } from "@misty/sdk";
import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";
import { createPort } from "@/shared/lib/seams";

export interface LiveNoteEditorProps {
  fragment: Y.XmlFragment;
  awareness: Awareness;
  user: { id: string; name: string; color: string };
  editable: boolean;
  seed?: string;
  onSeeded?(): void;
  label: string;
  onMarkdown(markdown: string): void;
  onFocusChange?(focused: boolean): void;
}

export type DocVisibility = "public" | "private";

export type PersonPlace = { spaceId: string; place: "studio" | "lab"; itemId?: string };

export interface SpaceDriveFile {
  id: string;
  space_id: string;
  path: string;
  name: string;
  kind: "file" | "folder";
  size: number;
  mtime_ms: number;
  modified_by_name: string;
  version?: number;
}

export type SpaceDriveBytes = ArrayBuffer | Uint8Array | Blob;

interface SpacesGateway {
  saveToDrive(
    spaceId: string,
    folder: string,
    name: string,
    bytes: SpaceDriveBytes,
  ): Promise<SpaceDriveFile>;
  saveFileToDrive(
    spaceId: string,
    folder: string,
    path: string,
    name?: string,
  ): Promise<SpaceDriveFile>;
  driveList(
    spaceId: string,
    folder: string,
    options?: { cursor?: string; limit?: number },
  ): Promise<{ entries: SpaceDriveFile[]; next_cursor?: string | null }>;
  driveEntry(spaceId: string, path: string): Promise<SpaceDriveFile | null>;
  driveRead(spaceId: string, path: string): Promise<ArrayBuffer>;
  driveReplace(
    spaceId: string,
    file: Pick<SpaceDriveFile, "id" | "path" | "name" | "version">,
    bytes: SpaceDriveBytes,
  ): Promise<SpaceDriveFile>;
  driveTrash(spaceId: string, path: string): Promise<void>;
  attachmentContent(spaceId: string, attachmentId: string): Promise<Blob>;
  sharedWindowSpace(): { id: string; name: string } | undefined;
  otherMembers(spaceId: string): Promise<{ userId: string; name: string }[]>;
  sendHandoff(spaceId: string, userId: string, text: string): Promise<void>;
  windowSpace(): { id: string; name: string } | undefined;
  saveDoc(
    spaceId: string,
    docId: string | undefined,
    title: string,
    markdown: string,
  ): Promise<{ id: string }>;
  listDocs(spaceId: string): Promise<{ id: string; title: string; creatorId: string }[]>;
  readDoc(spaceId: string, docId: string): Promise<string>;

  me(): { userId: string; name: string } | undefined;
  driveFile(spaceId: string, itemId: string): Promise<File>;
  createNotebookDoc(spaceId: string, title: string, markdown: string): Promise<{ id: string }>;
  deleteNotebookDoc(spaceId: string, docId: string): Promise<void>;
  createDoc(
    spaceId: string,
    title: string,
    markdown: string,
    visibility?: DocVisibility,
  ): Promise<{ id: string }>;
  setDocVisibility(spaceId: string, docId: string, visibility: DocVisibility): Promise<void>;
  docVisibility(spaceId: string, docId: string): Promise<DocVisibility | undefined>;
  VisibilityMenu: ComponentType<{
    label: string;
    visibility: DocVisibility | undefined;
    onChange(visibility: DocVisibility): void;
    className?: string;
  }>;
  notebookDocs(
    spaceId: string,
  ): Promise<{ id: string; title: string; creatorId: string; updatedAt?: string }[]>;
  memberName(spaceId: string, userId: string): string;
  memberPicture(spaceId: string, userId: string): Promise<string | null>;
  discussion(spaceId: string, title: string, known?: string): Promise<{ id: string }>;
  directMessages(
    spaceId: string,
    userId: string,
    limit?: number,
  ): Promise<{
    conversationId: string;
    messages: { id: string; mine: boolean; text: string; at: string }[];
  }>;
  sendDirectMessage(
    spaceId: string,
    userId: string,
    text: string,
  ): Promise<{ conversationId: string }>;
  askMembersAgent(
    spaceId: string,
    userId: string,
    agent: { id: string; name: string },
    text: string,
  ): Promise<void>;
  setPlace(place: PersonPlace | null): void;
  leavePlace(place: PersonPlace["place"], itemId?: string): void;
  NoteBodyEditor: ComponentType<LiveNoteEditorProps>;
  spaceRequest<T = void>(path: string, init?: RequestInit): Promise<T>;
  pageMisty(spaceId: string, page: "code" | "lab"): Misty;
}

export const spacesGateway = createPort<SpacesGateway>("Spaces for agents");
