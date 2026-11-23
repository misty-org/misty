import { useUserStore } from "@/features/account/core";
import { spacesApi } from "../api/api";
import { notesApi } from "../journal/notes/api/api";
import { followPendingMarkdown } from "../journal/notes/components/note_editor_content";
import { pageMisty } from "../apps/page_misty";
import {
  acquireNoteCollaborationSession,
  releaseNoteCollaborationSession,
} from "../journal/notes/note_collaboration";
import { leaveViewingPlace, setViewingPlace } from "../list/create_spaces_realtime_actions";
import { useSpacesStore } from "../list/use_spaces_store";
import { memberPicture, myPicture } from "../members/member_pictures";
import { LabNoteBodyEditor } from "../journal/notes/components/LabNoteBodyEditor";
import { handoffBody } from "./space_posts";
import { VisibilityMenu } from "../components/VisibilityMenu";
import { setItemVisibility, type ItemVisibility } from "../api/visibility";
import { driveFileById } from "../drive/drive_files";

const noteChanged = (spaceId: string) =>
  window.dispatchEvent(
    new CustomEvent("misty:space-note-event", { detail: { space_id: spaceId } }),
  );

export const liveGateway = {
  me(): { userId: string; name: string } | undefined {
    const me = useUserStore.getState().me;
    return me ? { userId: me.id, name: me.username || me.email } : undefined;
  },

  async openLiveDoc(spaceId: string, docId: string) {
    const session = await acquireNoteCollaborationSession(spaceId, docId);
    const room = pageMisty(spaceId, "lab").room(docId);
    let closed = false;
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

  driveFile: (spaceId: string, itemId: string) => driveFileById(spaceId, itemId),

  async createNotebookDoc(spaceId: string, title: string, markdown: string) {
    const note = await notesApi.createWithMarkdown(spaceId, title, markdown);
    noteChanged(spaceId);
    return { id: note.id };
  },

  async createDoc(spaceId: string, title: string, markdown: string, visibility?: ItemVisibility) {
    const note = await notesApi.createWithMarkdown(spaceId, title, markdown, visibility);
    noteChanged(spaceId);
    return { id: note.id };
  },

  async setDocVisibility(spaceId: string, docId: string, visibility: ItemVisibility) {
    await setItemVisibility(spaceId, "note", docId, visibility);
    noteChanged(spaceId);
  },

  async docVisibility(spaceId: string, docId: string): Promise<ItemVisibility | undefined> {
    return (await notesApi.get(spaceId, docId).catch(() => undefined))?.visibility;
  },

  VisibilityMenu,

  async deleteNotebookDoc(spaceId: string, docId: string) {
    await notesApi.remove(spaceId, docId);
    noteChanged(spaceId);
  },

  async notebookDocs(spaceId: string) {
    const { notes } = await notesApi.list(spaceId);
    return notes.map((note) => ({
      id: note.id,
      title: note.title,
      creatorId: note.creator_user_id,
      updatedAt: note.updated_at,
    }));
  },

  memberName(spaceId: string, userId: string): string {
    if (userId === useUserStore.getState().me?.id) return "You";
    const member = useSpacesStore
      .getState()
      .membersBySpace[spaceId]?.find((candidate) => candidate.user_id === userId);
    return member?.name || member?.email || "Someone";
  },

  memberPicture(spaceId: string, userId: string): Promise<string | null> {
    const mine = useUserStore.getState().me;
    if (mine && userId === mine.id) return myPicture(mine.avatar_version ?? 0);
    const member = useSpacesStore
      .getState()
      .membersBySpace[spaceId]?.find((candidate) => candidate.user_id === userId);
    return memberPicture(spaceId, userId, member?.avatar_version ?? 0);
  },

  async discussion(spaceId: string, title: string, known?: string) {
    if (known) return { id: known };
    const conversation = await spacesApi.createConversation(spaceId, title);
    return { id: conversation.id };
  },

  async directMessages(_spaceId: string, userId: string, limit = 6) {
    const dm = await spacesApi.openDirectMessage(userId);
    const { messages } = await spacesApi.messages(dm.id);
    return {
      conversationId: dm.id,
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

  async sendDirectMessage(_spaceId: string, userId: string, text: string) {
    const dm = await spacesApi.openDirectMessage(userId);
    await spacesApi.sendMessage(dm.id, [{ type: "text", text }]);
    return { conversationId: dm.id };
  },

  async askMembersAgent(
    _spaceId: string,
    userId: string,
    agent: { id: string; name: string },
    text: string,
  ) {
    const dm = await spacesApi.openDirectMessage(userId);
    await spacesApi.sendMessage(dm.id, [
      { type: "text", text: `${handoffBody(text)}\n` },
      { type: "mention", agent_id: agent.id, label: agent.name },
    ]);
  },

  setPlace(place: { spaceId: string; place: "studio" | "lab"; itemId?: string } | null) {
    setViewingPlace(place);
  },

  leavePlace(place: "studio" | "lab", itemId?: string) {
    leaveViewingPlace(place, itemId);
  },

  NoteBodyEditor: LabNoteBodyEditor,
};
