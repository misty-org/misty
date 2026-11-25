import { useMistyStore } from "../state/use_misty_store";
import { updateMistyDraftAttachments, useMistyDraftAttachments } from "./draft_attachments";
import { uploadMistyImage } from "./misty_image_attachments";

export async function attachFileToChat(
  file: File,
): Promise<{ conversationId: string; agentId?: string }> {
  const chat = useMistyStore.getState();
  const conversationId = chat.activeConversationId;
  if (!conversationId) throw new Error("Open a chat first, then add the picture.");
  const agentId = chat.conversations.find((item) => item.id === conversationId)?.agentId;
  const { accountId, generation } = useMistyDraftAttachments.getState();
  const uploaded = await uploadMistyImage(file, { conversationId });
  updateMistyDraftAttachments(
    accountId,
    conversationId,
    (items) => [...items, uploaded],
    generation,
  );
  return { conversationId, agentId };
}
