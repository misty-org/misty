import type { ComponentType } from "react";
import type { Misty } from "@misty/sdk";
import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";
import { createPort } from "@/shared/lib/seams";

/** A Space doc's live room, as a Lab notebook holds it. */
export interface LiveDoc {
  doc: Y.Doc;
  /** Everyone's presence in the room: pointers, carets, sections. */
  awareness: Awareness;
  role: "creator" | "editor" | "viewer";
  /** Settles once the room's copy has arrived, so a fresh doc isn't seeded over a full one. */
  synced: Promise<void>;
  /** Why the doc stopped syncing for good, once it has. */
  lost(): "deleted" | "revoked" | null;
  onLost(listener: () => void): () => void;
  /** Hands over Markdown the server wrote into the doc, in one open copy only. */
  followRewrites(apply: (markdown: string) => void): () => void;
  /** Lets go of the room; the connection closes once nothing holds it. */
  close(): void;
}

export interface LiveNoteEditorProps {
  fragment: Y.XmlFragment;
  awareness: Awareness;
  user: { id: string; name: string; color: string };
  editable: boolean;
  /** Markdown to start from when the shared text is empty or behind; taken once. */
  seed?: string;
  onSeeded?(): void;
  label: string;
  onMarkdown(markdown: string): void;
  onFocusChange?(focused: boolean): void;
}

/** A Space item's layer: shared with the Space, or its owner's alone. */
export type DocVisibility = "public" | "private";

/** Where in Misty a person is, for the Space's other members. */
export type PersonPlace = { spaceId: string; place: "studio" | "lab"; itemId?: string };

/** A file or folder in a Space's drive, as agents see it: its stable id and its path from the root. */
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

/** Bytes to save into a drive, in any of the shapes callers hold them. */
export type SpaceDriveBytes = ArrayBuffer | Uint8Array | Blob;

/** What agents ask of Spaces. Spaces sits above agents, so it fills this in once at startup. */
interface SpacesGateway {
  /** Saves a file named `name` into `folder` of a Space's drive and answers with what it became. */
  saveToDrive(
    spaceId: string,
    folder: string,
    name: string,
    bytes: SpaceDriveBytes,
  ): Promise<SpaceDriveFile>;
  /** The same for a file on this computer, read here and saved under its own name or `name`. */
  saveFileToDrive(
    spaceId: string,
    folder: string,
    path: string,
    name?: string,
  ): Promise<SpaceDriveFile>;
  /** What one folder of a Space's drive holds, a page at a time. */
  driveList(
    spaceId: string,
    folder: string,
    options?: { cursor?: string; limit?: number },
  ): Promise<{ entries: SpaceDriveFile[]; next_cursor?: string | null }>;
  /** The entry at a path of a Space's drive; null when nothing is there. */
  driveEntry(spaceId: string, path: string): Promise<SpaceDriveFile | null>;
  /** A drive file's bytes, fetched first when it is online only. */
  driveRead(spaceId: string, path: string): Promise<ArrayBuffer>;
  /**
   * Writes new content into a file already in the drive, made from the version given: native merges
   * text with what others saved since, or the last save wins with the replaced one in the trash.
   */
  driveReplace(
    spaceId: string,
    file: Pick<SpaceDriveFile, "id" | "path" | "name" | "version">,
    bytes: SpaceDriveBytes,
  ): Promise<SpaceDriveFile>;
  /** Moves a drive item to the Space's trash; refused while someone has it open. */
  driveTrash(spaceId: string, path: string): Promise<void>;
  /** A chat attachment's bytes, as the Space's server keeps them. */
  attachmentContent(spaceId: string, attachmentId: string): Promise<Blob>;
  /** The window's Space when other people are in it, where a reply can be handed to one of them. */
  sharedWindowSpace(): { id: string; name: string } | undefined;
  /** The other people in a Space. */
  otherMembers(spaceId: string): Promise<{ userId: string; name: string }[]>;
  /**
   * Sends words the person reviewed to one member, as the person's own message. Never called
   * with text nobody read: the agent's reply is only the draft the person edits and sends.
   */
  sendHandoff(spaceId: string, userId: string, text: string): Promise<void>;
  /** The window's Space, shared or not, for sharing a notebook into it. */
  windowSpace(): { id: string; name: string } | undefined;
  /**
   * Writes a doc the person chose to share: a new one, or `docId` replaced. Only for what they
   * asked to share, such as a Lab notebook they turned sharing on for.
   */
  saveDoc(
    spaceId: string,
    docId: string | undefined,
    title: string,
    markdown: string,
  ): Promise<{ id: string }>;
  /** The Space's docs: their titles and who made each. */
  listDocs(spaceId: string): Promise<{ id: string; title: string; creatorId: string }[]>;
  /** One doc's body as Markdown. */
  readDoc(spaceId: string, docId: string): Promise<string>;

  /** The signed-in person, as others in a Space see them. */
  me(): { userId: string; name: string } | undefined;
  openLiveDoc(spaceId: string, docId: string): Promise<LiveDoc>;
  /** One of a Space's drive files, found by its stable id and read whole. */
  driveFile(spaceId: string, itemId: string): Promise<File>;
  /** Makes the Space doc a new notebook lives in. */
  createNotebookDoc(spaceId: string, title: string, markdown: string): Promise<{ id: string }>;
  /** Deletes a notebook's doc from its Space, for everyone in it. */
  deleteNotebookDoc(spaceId: string, docId: string): Promise<void>;
  /** Makes a doc on a chosen layer from its first moment. */
  createDoc(
    spaceId: string,
    title: string,
    markdown: string,
    visibility?: DocVisibility,
  ): Promise<{ id: string }>;
  /** Puts the person's own doc on a layer. */
  setDocVisibility(spaceId: string, docId: string, visibility: DocVisibility): Promise<void>;
  /** A doc's layer, or undefined when it can't be read. */
  docVisibility(spaceId: string, docId: string): Promise<DocVisibility | undefined>;
  /** The Space's private/shared menu for an item of the person's own. */
  VisibilityMenu: ComponentType<{
    label: string;
    visibility: DocVisibility | undefined;
    onChange(visibility: DocVisibility): void;
    className?: string;
  }>;
  notebookDocs(
    spaceId: string,
  ): Promise<{ id: string; title: string; creatorId: string; updatedAt?: string }[]>;
  /** A member's name, or "You". */
  memberName(spaceId: string, userId: string): string;
  memberPicture(spaceId: string, userId: string): Promise<string | null>;
  /** The Space chat a notebook's people talk in, made the first time anyone opens it. */
  discussion(spaceId: string, title: string, known?: string): Promise<{ id: string }>;
  directMessages(
    spaceId: string,
    userId: string,
    limit?: number,
  ): Promise<{
    conversationId: string;
    messages: { id: string; mine: boolean; text: string; at: string }[];
  }>;
  /** Sends the person's own words to one member. */
  sendDirectMessage(
    spaceId: string,
    userId: string,
    text: string,
  ): Promise<{ conversationId: string }>;
  /** Sends a request for a member's agent to that member, who decides whether to pass it on. */
  askMembersAgent(
    spaceId: string,
    userId: string,
    agent: { id: string; name: string },
    text: string,
  ): Promise<void>;
  /** Where in Misty the person is now: the Studio, a notebook, or nowhere in particular. */
  setPlace(place: PersonPlace | null): void;
  /** Leaves a place (and only that notebook, given its id), unless the person went elsewhere. */
  leavePlace(place: PersonPlace["place"], itemId?: string): void;
  NoteBodyEditor: ComponentType<LiveNoteEditorProps>;
  /** A Space page's bar title: the Space's mark and name (back to its home), then the page. */
  SpaceCrumb: ComponentType<{ spaceId: string; here: string }>;
  /** A call to the Space server's API, for records agents' pages keep there (live code sessions). */
  spaceRequest<T = void>(path: string, init?: RequestInit): Promise<T>;
  /**
   * The misty-sdk client Code or Lab talks through in a Space, as any app does: its rooms are a live session's
   * repository (Code, by session id) or a notebook's doc (Lab, by doc id).
   */
  pageMisty(spaceId: string, page: "code" | "lab"): Misty;
}

export const spacesGateway = createPort<SpacesGateway>("Spaces for agents");
