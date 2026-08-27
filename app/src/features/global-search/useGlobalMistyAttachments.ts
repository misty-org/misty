import { useState } from "react";
import { deleteMistyImage, uploadMistyImage } from "./mistyImageAttachments";
import type { GlobalAiMode, MistyImageAttachment } from "./types";

export function useGlobalMistyAttachments(input: {
  mode: GlobalAiMode;
  activeConversationId: string;
  newConversation: () => Promise<string>;
  setMode: (mode: GlobalAiMode) => void;
  onError: (message: string) => void;
}) {
  const [attachments, setAttachments] = useState<MistyImageAttachment[]>([]);
  const addFiles = async (files: File[]) => {
    input.onError("");
    let conversationId = input.activeConversationId;
    if (input.mode === "ask" && !conversationId) conversationId = await input.newConversation();
    for (const file of files) {
      const draftId = `draft-${crypto.randomUUID()}`;
      const previewUrl = URL.createObjectURL(file);
      const placeholder: MistyImageAttachment = {
        id: draftId,
        name: file.name,
        mimeType: file.type as MistyImageAttachment["mimeType"],
        byteSize: file.size,
        width: 1,
        height: 1,
        previewUrl,
        state: "uploading",
        progress: 0,
      };
      setAttachments((items) => [...items, placeholder]);
      try {
        const uploaded = await uploadMistyImage(file, {
          scope: input.mode === "search" ? "visual_query" : "conversation",
          conversationId: input.mode === "ask" ? conversationId : undefined,
          onProgress: (progress) =>
            setAttachments((items) =>
              items.map((item) => (item.id === draftId ? { ...item, progress } : item)),
            ),
        });
        URL.revokeObjectURL(previewUrl);
        setAttachments((items) => items.map((item) => (item.id === draftId ? uploaded : item)));
      } catch (error) {
        setAttachments((items) =>
          items.map((item) => (item.id === draftId ? { ...item, state: "failed" } : item)),
        );
        input.onError(
          error instanceof Error ? error.message : "Misty could not upload that image.",
        );
      }
    }
  };
  const remove = async (attachment: MistyImageAttachment) => {
    setAttachments((items) => items.filter((item) => item.id !== attachment.id));
    await deleteMistyImage(attachment).catch(() => undefined);
  };
  const consume = () => {
    const sent = attachments;
    setAttachments([]);
    sent.forEach(
      (item) => item.previewUrl.startsWith("blob:") && URL.revokeObjectURL(item.previewUrl),
    );
    return sent;
  };
  const changeMode = (nextMode: GlobalAiMode) => {
    if (nextMode !== input.mode && attachments.length) {
      const stale = attachments;
      setAttachments([]);
      stale.forEach((attachment) => void deleteMistyImage(attachment).catch(() => undefined));
    }
    input.setMode(nextMode);
  };
  return { attachments, addFiles, remove, consume, changeMode };
}
