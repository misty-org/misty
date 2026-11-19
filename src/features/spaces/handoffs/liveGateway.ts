import { useUserStore } from "@/features/account/core";
import { spacesApi } from "../api/api";
import { notesApi } from "../journal/notes/api/api";
import { followPendingMarkdown } from "../journal/notes/components/noteEditorContent";
import {
  acquireNoteCollaborationSession,
  releaseNoteCollaborationSession,
} from "../journal/notes/noteCollaboration";
import { leaveViewingPlace, setViewingPlace } from "../list/createSpacesRealtimeActions";
import { useSpacesStore } from "../list/useSpacesStore";
import { memberPicture, myPicture } from "../members/memberPictures";
import { LabNoteBodyEditor } from "../journal/notes/components/LabNoteBodyEditor";
import { handoffBody } from "./spacePosts";
import { SpaceCrumb } from "../components/space-row/SpaceCrumb";
import { VisibilityMenu } from "../components/VisibilityMenu";
import type { ItemVisibility } from "../api/visibility";
import { setHostVisibility } from "../embeds/hostVisibility";
import { spaceRequest } from "../api/api";
import type { SpaceLibraryItem } from "../api/dto/entities";
import { libraryItemMIME } from "../library/library-primitives/libraryMediaTypes";
import { editedImageFilename } from "../library/library-viewer/libraryMediaKind";
import {
  acquireImageSession,
  releaseImageSession,
} from "../library/library-viewer/imageCollaboration";
import {
  clearImageEdit,
  imageDocBase,
  imageDocParts,
  isVideoProjectFile,
  newerProject,
  parseVideoProject,
  readRoomProject,
  VIDEO_PROJECT_MIME,
  writeRoomProject,
  type VideoProjectDocument,
} from "@/features/files";
import { libraryFileById } from "../library/library-viewer/useVideoEditorSpace";

/** Tells the open Library a file changed, so it shows the new one. */
const notifyLibraryChanged = (spaceId: string) =>
  window.dispatchEvent(
    new CustomEvent("misty:space-library-event", { detail: { space_id: spaceId } }),
  );

const noteChanged = (spaceId: string) =>
  window.dispatchEvent(
    new CustomEvent("misty:space-note-event", { detail: { space_id: spaceId } }),
  );

/**
 * What the Lab and the Studio need of Spaces to work together live: a notebook's room, the people
 * in a Space, their pictures, direct messages and where each person is. Nothing here is a step a
 * person takes to share: a notebook is its Space's from the start, like anything an agent makes.
 */
export const liveGateway = {
  /** The signed-in person, as others in a Space see them. */
  me(): { userId: string; name: string } | undefined {
    const me = useUserStore.getState().me;
    return me ? { userId: me.id, name: me.username || me.email } : undefined;
  },

  /** A notebook's live room: its shared doc and awareness, held until `close`. */
  async openLiveDoc(spaceId: string, docId: string) {
    const session = await acquireNoteCollaborationSession(spaceId, docId);
    let closed = false;
    const provider = session.provider;
    const synced = provider.synced
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          const onSync = (done: boolean) => {
            if (!done) return;
            provider.off("sync", onSync);
            resolve();
          };
          provider.on("sync", onSync);
        });
    return {
      doc: session.doc,
      awareness: provider.awareness,
      role: session.ticket.role,
      synced,
      lost: () => session.access.lost,
      onLost: (listener: () => void) => session.access.subscribe(listener),
      /**
       * Hands `apply` the Markdown the server wrote into this doc (an API or agent rewrite), in
       * one open copy only, so the notebook can take it into its own types.
       */
      followRewrites: (apply: (markdown: string) => void) =>
        followPendingMarkdown(
          { role: session.ticket.role, metadata: session.metadata, provider },
          { gone: () => closed, apply },
        ),
      close() {
        if (closed) return;
        closed = true;
        provider.awareness.setLocalState(null);
        releaseNoteCollaborationSession(spaceId, docId);
      },
    };
  },

  /**
   * A Library image's live edit, for an agent: the item, the room everyone editing it shares, and
   * saving the edit into an image. An edit left from before the image last changed is cleared
   * once the room's copy arrives, as the editor does.
   */
  async openLibraryImage(spaceId: string, itemId: string) {
    const itemPath = `/spaces/${encodeURIComponent(spaceId)}/library/items/${encodeURIComponent(itemId)}`;
    const item = await spaceRequest<SpaceLibraryItem>(itemPath);
    const mimeType = libraryItemMIME(item);
    if (!mimeType.startsWith("image/")) throw new Error("This Library item isn't an image.");
    const session = await acquireImageSession(spaceId, itemId);
    const provider = session.provider;
    let closed = false;
    const synced = (
      provider.synced
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            const onSync = (done: boolean) => {
              if (!done) return;
              provider.off("synced", onSync);
              resolve();
            };
            provider.on("synced", onSync);
          })
    ).then(() => {
      if (session.role === "viewer") return;
      const parts = imageDocParts(session.doc);
      const base = imageDocBase(parts);
      if (base === null) session.doc.transact(() => parts.meta.set("base", String(item.version)));
      else if (!(Number(base) >= item.version))
        clearImageEdit(parts, String(item.version), { image: "base" });
    });
    const metadata = item.file.intrinsic_metadata;
    return {
      name: item.display_name,
      version: item.version,
      mimeType,
      width: Number(metadata.width ?? 0),
      height: Number(metadata.height ?? 0),
      doc: session.doc,
      awareness: provider.awareness,
      role: session.role,
      synced,
      original: () => spacesApi.libraryContent(spaceId, itemId),
      async replace(blob: Blob) {
        // The item as it is now, so a save over a newer version is refused, not lost.
        const current = await spaceRequest<SpaceLibraryItem>(itemPath);
        const result = await spacesApi.replaceLibraryItemContent(
          spaceId,
          current,
          blob,
          editedImageFilename(current.display_name, blob.type || mimeType),
        );
        notifyLibraryChanged(spaceId);
        return result.item?.version ?? current.version + 1;
      },
      async saveCopy(blob: Blob, filename: string) {
        const result = await spacesApi.uploadLibraryBlob(spaceId, blob, filename, "library");
        notifyLibraryChanged(spaceId);
        return result.item ? { id: result.item.id } : undefined;
      },
      close() {
        if (closed) return;
        closed = true;
        releaseImageSession(spaceId, itemId);
      },
    };
  },

  /** One of a Space's Media files, read whole. */
  libraryFile: (spaceId: string, itemId: string) => libraryFileById(spaceId, itemId),

  /**
   * A video project in Media, for an agent: read as the newer of its file and its live room, and
   * kept as a new version of its file and in the room, so open editors show the change at once.
   */
  async openLibraryVideo(spaceId: string, itemId: string) {
    const itemPath = `/spaces/${encodeURIComponent(spaceId)}/library/items/${encodeURIComponent(itemId)}`;
    const item = await spaceRequest<SpaceLibraryItem>(itemPath);
    if (!isVideoProjectFile(libraryItemMIME(item), item.file.original_filename))
      throw new Error("This Media item isn't a video project.");
    const session = await acquireImageSession(spaceId, itemId);
    const provider = session.provider;
    const synced = provider.synced
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          const onSync = (done: boolean) => {
            if (!done) return;
            provider.off("synced", onSync);
            resolve();
          };
          provider.on("synced", onSync);
          // A room that can't be reached doesn't hold the project back: the file still is.
          window.setTimeout(resolve, 8000);
        });
    let closed = false;
    return {
      name: item.display_name.replace(/\.mistyvideo$/i, ""),
      role: session.role,
      async read() {
        await synced;
        const blob = await spacesApi.libraryContent(spaceId, itemId);
        return newerProject(parseVideoProject(await blob.text()), readRoomProject(session.doc));
      },
      async keep(document: VideoProjectDocument) {
        if (session.role === "viewer") throw new Error("This video can only be viewed here.");
        const current = await spaceRequest<SpaceLibraryItem>(itemPath);
        await spacesApi.replaceLibraryItemContent(
          spaceId,
          current,
          new Blob([JSON.stringify(document)], { type: VIDEO_PROJECT_MIME }),
          current.file.original_filename || `${current.display_name}.mistyvideo`,
        );
        writeRoomProject(session.doc, document);
        notifyLibraryChanged(spaceId);
      },
      loadMedia: (mediaId: string) => libraryFileById(spaceId, mediaId),
      close() {
        if (closed) return;
        closed = true;
        releaseImageSession(spaceId, itemId);
      },
    };
  },

  /** Makes the Space doc a new notebook lives in. */
  async createNotebookDoc(spaceId: string, title: string, markdown: string) {
    const note = await notesApi.createWithMarkdown(spaceId, title, markdown);
    noteChanged(spaceId);
    return { id: note.id };
  },

  /** Makes a doc on a chosen layer from its first moment, as a person's Lab questions are. */
  async createDoc(spaceId: string, title: string, markdown: string, visibility?: ItemVisibility) {
    const note = await notesApi.createWithMarkdown(spaceId, title, markdown, visibility);
    noteChanged(spaceId);
    return { id: note.id };
  },

  /** Puts the person's own doc on a layer: private to them, or shared with the Space. */
  async setDocVisibility(spaceId: string, docId: string, visibility: ItemVisibility) {
    // A doc turning shared shares what it embeds first; declined, it stays as it was.
    await setHostVisibility(spaceId, "note", docId, visibility);
    noteChanged(spaceId);
  },

  /** A doc's layer, or undefined when it can't be read (someone else's private doc). */
  async docVisibility(spaceId: string, docId: string): Promise<ItemVisibility | undefined> {
    return (await notesApi.get(spaceId, docId).catch(() => undefined))?.visibility;
  },

  /** The Space's private/shared menu for an item of the person's own. */
  VisibilityMenu,

  /** Deletes a notebook's doc from its Space, for everyone in it. */
  async deleteNotebookDoc(spaceId: string, docId: string) {
    await notesApi.remove(spaceId, docId);
    noteChanged(spaceId);
  },

  /** The Space's docs: their titles, who made each and when they last changed. */
  async notebookDocs(spaceId: string) {
    const { notes } = await notesApi.list(spaceId);
    return notes.map((note) => ({
      id: note.id,
      title: note.title,
      creatorId: note.creator_user_id,
      updatedAt: note.updated_at,
    }));
  },

  /** A member's name, or "You", for a credit line. */
  memberName(spaceId: string, userId: string): string {
    if (userId === useUserStore.getState().me?.id) return "You";
    const member = useSpacesStore
      .getState()
      .membersBySpace[spaceId]?.find((candidate) => candidate.user_id === userId);
    return member?.name || member?.email || "Someone";
  },

  /** A member's picture as an object URL, or null when they have none. */
  memberPicture(spaceId: string, userId: string): Promise<string | null> {
    const mine = useUserStore.getState().me;
    if (mine && userId === mine.id) return myPicture(mine.avatar_version ?? 0);
    const member = useSpacesStore
      .getState()
      .membersBySpace[spaceId]?.find((candidate) => candidate.user_id === userId);
    return memberPicture(spaceId, userId, member?.avatar_version ?? 0);
  },

  /** The Space chat everyone in a notebook talks in, made the first time anyone opens it. */
  async discussion(spaceId: string, title: string, known?: string) {
    if (known) return { id: known };
    const conversation = await spacesApi.createConversation(spaceId, title);
    return { id: conversation.id };
  },

  /** The last few messages between the person and one member, oldest first. */
  async directMessages(spaceId: string, userId: string, limit = 6) {
    const conversation = await spacesApi.openDirectMessage(spaceId, userId);
    const { messages } = await spacesApi.conversationMessages(spaceId, conversation.id);
    return {
      conversationId: conversation.id,
      messages: messages.slice(-limit).map((message) => ({
        id: message.id,
        mine: message.sender_user_id === useUserStore.getState().me?.id,
        text: message.content
          .map((span) => (span.type === "text" ? span.text : span.label))
          .join(""),
        at: message.created_at,
      })),
    };
  },

  /** Sends the person's own words to one member as a direct message. */
  async sendDirectMessage(spaceId: string, userId: string, text: string) {
    const conversation = await spacesApi.openDirectMessage(spaceId, userId);
    await spacesApi.sendConversationMessage(spaceId, conversation.id, [{ type: "text", text }]);
    return { conversationId: conversation.id };
  },

  /**
   * Sends a request for one of a member's agents to that member, as the person's handoff. The
   * member decides whether to give it to the agent; it never reaches the agent on its own.
   */
  async askMembersAgent(
    spaceId: string,
    userId: string,
    agent: { id: string; name: string },
    text: string,
  ) {
    const conversation = await spacesApi.openDirectMessage(spaceId, userId);
    await spacesApi.sendConversationMessage(spaceId, conversation.id, [
      { type: "text", text: `${handoffBody(text)}\n` },
      { type: "mention", agent_id: agent.id, label: agent.name },
    ]);
  },

  /** Where in Misty the person is now, for the Space's other members: the Studio or a notebook. */
  setPlace(place: { spaceId: string; place: "studio" | "lab"; itemId?: string } | null) {
    setViewingPlace(place);
  },

  /** Leaves a place, unless the person has since gone somewhere else. */
  leavePlace(place: "studio" | "lab", itemId?: string) {
    leaveViewingPlace(place, itemId);
  },

  /** A Lab note's shared body editor, with everyone's carets. */
  NoteBodyEditor: LabNoteBodyEditor,

  /** A Space page's bar title: the Space's mark and name (back to its home), then the page. */
  SpaceCrumb,
};
