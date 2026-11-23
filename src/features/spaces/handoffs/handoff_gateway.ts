import { useUserStore } from "@/features/account/core";
import { spacesApi } from "../api/api";
import { notesApi } from "../journal/notes/api/api";
import { useSpacesStore } from "../list/use_spaces_store";
import { windowSpace } from "../routes/default_space";
import { handoffBody } from "./space_posts";

export const handoffGateway = {
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
  async sendHandoff(_spaceId: string, userId: string, text: string): Promise<void> {
    const dm = await spacesApi.openDirectMessage(userId);
    await spacesApi.sendMessage(dm.id, [{ type: "text", text: handoffBody(text) }]);
  },
};
