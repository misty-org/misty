import type { VideoProjectDocument } from "@/features/files";
import type { ComponentType } from "react";
import type YProvider from "y-partyserver/provider";
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

/**
 * A Space Library image as an agent edits it: what it is, its live edit (the room everyone
 * editing it shares, held until `close`), and saving that edit into an image.
 */
export interface LiveLibraryImage {
  name: string;
  /** The item's version: a save over it makes a new one. */
  version: number;
  mimeType: string;
  /** Its size in pixels, when the Library knows it. */
  width: number;
  height: number;
  doc: Y.Doc;
  awareness: Awareness;
  role: "creator" | "editor" | "viewer";
  /** Settles once the room's copy of the edit has arrived. */
  synced: Promise<void>;
  /** The full-size original. */
  original(): Promise<Blob>;
  /** Saves an edited image over the item; answers with the version it now is. */
  replace(blob: Blob): Promise<number>;
  /** Adds an edited image to the Library as a new item. */
  saveCopy(blob: Blob, filename: string): Promise<{ id: string } | undefined>;
  close(): void;
}

/** A Lab note's shared body editor, with everyone's carets. */
/**
 * A video project in a Space's Media as an agent edits it. A change is kept as a new version of
 * the project's file and put in its live room, so every editor with it open shows it at once.
 */
export interface LiveLibraryVideo {
  name: string;
  /** Who the agent's person is in the project: only a viewer can't keep changes. */
  role: "viewer" | "editor" | "creator";
  /** The project as it is now: the newer of its kept file and its live room. */
  read(): Promise<VideoProjectDocument>;
  /** Keeps a changed project. */
  keep(document: VideoProjectDocument): Promise<void>;
  /** Reads one of the Media items the project uses. */
  loadMedia(itemId: string): Promise<File>;
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

/** Who made a Library item, for the credit line on it. */
export interface AgentArtifactProvenance {
  agent_id: string;
  conversation_id?: string;
  run_id?: string;
  kind: "download" | "file" | "image" | "document";
}

type Uploaded = Promise<{ item?: { id: string } }>;

/** A ticket into one of the Space server's live rooms. */
export interface RoomTicket {
  ticket: string;
  room: string;
  url: string;
}

/** Whether a live room is still reachable; once lost, its connection stays closed. */
export interface RoomAccess {
  readonly lost: "deleted" | "revoked" | null;
  subscribe(listener: () => void): () => void;
  lose(reason: "deleted" | "revoked"): void;
  retry(): void;
}

/** The Space items whose content lives in a live room: a doc, a whiteboard, a deck, a workbook. */
export type ItemDocKind = "note" | "drawing" | "deck" | "workbook";

/**
 * What agent tools use to write into docs, decks, workbooks and whiteboards. Each item's content
 * is a live room, so a tool joins it as this computer, changes it as people do, and leaves once
 * the room has the change: what an agent makes is whole at once, opened or not (plan F3). The
 * shapes are the Spaces feature's own (`docs/plans/space-artifacts-contract.md`); agents pass the
 * model's arguments through and hand back what they return.
 */
export interface SpaceItemTools {
  /** Opens the item's room, runs `change` on its document, waits for the room to have it, leaves. */
  edit<T>(
    kind: ItemDocKind,
    spaceId: string,
    itemId: string,
    change: (doc: Y.Doc) => T | Promise<T>,
  ): Promise<T>;
  /** Fills a doc's body from Markdown, as an opened editor would. */
  writeNoteMarkdown(doc: Y.Doc, markdown: string): void;
  createDeck(doc: Y.Doc, input: Record<string, unknown>): void;
  readDeck(doc: Y.Doc): unknown;
  applyDeckOps(doc: Y.Doc, ops: unknown[]): unknown;
  /** Overflowing, empty and crowded slots, measured the way the deck draws them. */
  lintDeck(doc: Y.Doc): Promise<unknown[]>;
  /** A picture from the web, for a slide; refused when the address isn't a picture. */
  fetchPicture(url: string, signal?: AbortSignal): Promise<File>;
  /** Adds a picture to a deck's assets and says its id. */
  uploadDeckImage(spaceId: string, deckId: string, file: File): Promise<string>;
  createWorkbook(doc: Y.Doc, input: Record<string, unknown>): void;
  readWorkbook(doc: Y.Doc, args: Record<string, unknown>): unknown;
  applyWorkbookOps(doc: Y.Doc, ops: unknown[]): unknown;
  importWorkbookFile(doc: Y.Doc, file: File): Promise<unknown>;
  /**
   * Why each `::embed{…}` in a doc's Markdown may not go into it: a private source in a shared doc,
   * someone else's private item, or one that isn't there. Empty when every embed may go in.
   */
  embedRefusals(
    spaceId: string,
    host: { visibility: "public" | "private"; creatorId?: string },
    markdown: string,
  ): Promise<string[]>;
  /** Draws a Mermaid diagram onto a whiteboard. */
  mermaidToDrawing(spaceId: string, drawingId: string, mermaid: string): Promise<unknown>;
}

/** What agents ask of Spaces. Spaces sits above agents, so it fills this in once at startup. */
interface SpacesGateway {
  uploadLibraryPath(
    spaceId: string,
    path: string,
    purpose: "library" | "attachment",
    options?: { agent?: AgentArtifactProvenance },
  ): Uploaded;
  /** Adds a file to a Space's Library as a new item; `agent` credits the agent that made it. */
  uploadLibraryBlob(
    spaceId: string,
    blob: Blob,
    filename: string,
    purpose?: "library" | "attachment",
    options?: { agent?: AgentArtifactProvenance; signal?: AbortSignal },
  ): Uploaded;
  /** Makes a drawing in a Space and puts these Excalidraw elements on it. */
  createDrawing(
    spaceId: string,
    title: string,
    elements: readonly unknown[],
  ): Promise<{ id: string }>;
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

  /** The Space's games for the studio's arcade: its Library's tagged HTML pages, newest first. */
  spaceGames(spaceId: string): Promise<{ id: string; name: string; addedAt: string }[]>;
  /** One game's page, to play in a sandboxed frame. */
  gameHtml(spaceId: string, itemId: string): Promise<string>;
  /** How many notes the Space has, for the studio's milestones. */
  noteCount(spaceId: string): Promise<number>;

  /** The signed-in person, as others in a Space see them. */
  me(): { userId: string; name: string } | undefined;
  openLiveDoc(spaceId: string, docId: string): Promise<LiveDoc>;
  /** A Library image's live edit, for an agent to read and change alongside the people in it. */
  openLibraryImage(spaceId: string, itemId: string): Promise<LiveLibraryImage>;
  /** One of a Space's Media files, read whole. */
  libraryFile(spaceId: string, itemId: string): Promise<File>;
  /** A video project in Media, for an agent to read and change alongside the people editing it. */
  openLibraryVideo(spaceId: string, itemId: string): Promise<LiveLibraryVideo>;
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
  /** Docs, decks, workbooks and whiteboards for agent tools, loaded on first use. */
  itemTools(): Promise<SpaceItemTools>;
  /** Opens a live code session's room for its shared doc, with a fresh ticket per reconnect. */
  openCodeRoom(
    ticket: RoomTicket,
    doc: Y.Doc,
    refresh: () => Promise<RoomTicket>,
  ): { provider: YProvider; access: RoomAccess };
}

export const spacesGateway = createPort<SpacesGateway>("Spaces for agents");
