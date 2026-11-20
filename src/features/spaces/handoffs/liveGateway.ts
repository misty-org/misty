import { useUserStore } from "@/features/account/core";
import { spacesApi } from "../api/api";
import { notesApi } from "../journal/notes/api/api";
import { followPendingMarkdown } from "../journal/notes/components/noteEditorContent";
import { pageMisty } from "../apps/pageMisty";
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
import { setItemVisibility, type ItemVisibility } from "../api/visibility";
import { libraryFileById } from "../library/library-data/libraryFile";

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

  /**
   * A notebook's live room, through misty-sdk as any app's: its shared doc and awareness, held until `close`.
   * The note's own role and the rewrites the server writes into it come from the note's connection here.
   */
  async openLiveDoc(spaceId: string, docId: string) {
    const session = await acquireNoteCollaborationSession(spaceId, docId);
    const room = pageMisty(spaceId, "lab").room(docId);
    let closed = false;
    // Deleted or no longer theirs; anything else (the connection closing) isn't a loss the notebook shows, and a
    // room that never syncs says so when its open times out.
    const lost = (): "deleted" | "revoked" | null =>
      room.lost?.code === "not_found"
        ? "deleted"
        : room.lost?.code === "permission_denied"
          ? "revoked"
          : session.access.lost;
    return {
      doc: room.doc,
      awareness: room.awareness,
      role: session.ticket.role,
      // A room that can't open settles through `lost`, which `onLost` reports.
      synced: room.synced.catch(() => new Promise<void>(() => {})),
      lost,
      onLost(listener: () => void) {
        const stopRoom = room.onLost(() => listener());
        const stopSession = session.access.subscribe(listener);
        return () => {
          stopRoom();
          stopSession();
        };
      },
      /**
       * Hands `apply` the Markdown the server wrote into this doc (an API or agent rewrite), in
       * one open copy only, so the notebook can take it into its own types.
       */
      followRewrites: (apply: (markdown: string) => void) =>
        followPendingMarkdown(
          { role: session.ticket.role, metadata: session.metadata, provider: session.provider },
          { gone: () => closed, apply },
        ),
      close() {
        if (closed) return;
        closed = true;
        room.destroy();
        releaseNoteCollaborationSession(spaceId, docId);
      },
    };
  },

  /** One of a Space's files, read whole. */
  libraryFile: (spaceId: string, itemId: string) => libraryFileById(spaceId, itemId),

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
    await setItemVisibility(spaceId, "note", docId, visibility);
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
