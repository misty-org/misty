import { useUserStore } from "@/features/account/core";
import { spacesApi } from "../api/api";
import { notesApi } from "../journal/notes/api/api";
import { useSpacesStore } from "../list/useSpacesStore";
import { windowSpace } from "../routes/defaultSpace";
import { handoffBody } from "./spacePosts";

/**
 * What an agent chat needs to hand a reply to another member. Every call here is the person's
 * own: the text sent is what they reviewed and pressed Send on, posted as their message.
 */
export const handoffGateway = {
  /** The window's Space when other people are in it. */
  sharedWindowSpace(): { id: string; name: string } | undefined {
    const space = windowSpace(useSpacesStore.getState().spaces);
    return space?.is_shared && space.member_count > 1
      ? { id: space.id, name: space.name }
      : undefined;
  },
  async otherMembers(spaceId: string): Promise<{ userId: string; name: string }[]> {
    const me = useUserStore.getState().me?.id;
    const { members } = await spacesApi.members(spaceId);
    return members
      .filter((member) => member.user_id !== me)
      .map((member) => ({ userId: member.user_id, name: member.name || member.email }));
  },
  windowSpace(): { id: string; name: string } | undefined {
    const space = windowSpace(useSpacesStore.getState().spaces);
    return space ? { id: space.id, name: space.name } : undefined;
  },
  async saveDoc(spaceId: string, docId: string | undefined, title: string, markdown: string) {
    const note = docId
      ? await notesApi.replaceContent(spaceId, docId, title, markdown)
      : await notesApi.createWithMarkdown(spaceId, title, markdown);
    window.dispatchEvent(
      new CustomEvent("misty:space-note-event", { detail: { space_id: spaceId } }),
    );
    return { id: note.id };
  },
  async listDocs(spaceId: string) {
    const { notes } = await notesApi.list(spaceId);
    return notes.map((note) => ({
      id: note.id,
      title: note.title,
      creatorId: note.creator_user_id,
    }));
  },
  async readDoc(spaceId: string, docId: string) {
    return (await notesApi.get(spaceId, docId)).markdown ?? "";
  },
  /** Sends the text as the person's direct message to one member, marked as a handoff. */
  async sendHandoff(spaceId: string, userId: string, text: string): Promise<void> {
    const conversation = await spacesApi.openDirectMessage(spaceId, userId);
    await spacesApi.sendConversationMessage(spaceId, conversation.id, [
      { type: "text", text: handoffBody(text) },
    ]);
  },
};
