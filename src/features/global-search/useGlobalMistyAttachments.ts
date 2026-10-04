import { useState } from "react";
import { deleteMistyImage, uploadMistyImage } from "./mistyImageAttachments";
import type { GlobalAiMode, MistyImageAttachment } from "./types";
import {
  readMistyDraftAttachments,
  updateMistyDraftAttachments,
  useMistyDraftAttachments,
} from "@/features/misty/draftAttachments";

export function useGlobalMistyAttachments(input: {
  mode: GlobalAiMode;
  activeConversationId: string;
  newConversation: () => Promise<string>;
  setMode: (mode: GlobalAiMode) => void;
  onError: (message: string) => void;
  sharedAccountId?: string;
}) {
  const [localAttachments, setLocalAttachments] = useState<MistyImageAttachment[]>([]);
  const shared = useMistyDraftAttachments(() =>
    readMistyDraftAttachments(input.sharedAccountId ?? "", input.activeConversationId),
  );
  const generation = useMistyDraftAttachments((state) => state.generation);
  const currentAccount = () =>
    !input.sharedAccountId ||
    (useMistyDraftAttachments.getState().accountId === input.sharedAccountId &&
      useMistyDraftAttachments.getState().generation === generation);
  const attachments = input.sharedAccountId ? shared : localAttachments;
  const setAttachments = (
    update: (items: MistyImageAttachment[]) => MistyImageAttachment[],
    conversationId = input.activeConversationId,
  ) => {
    if (input.sharedAccountId)
      updateMistyDraftAttachments(input.sharedAccountId, conversationId, update, generation);
    else setLocalAttachments(update);
  };
  const addFiles = async (files: File[]) => {
    input.onError("");
    let conversationId = input.activeConversationId;
    if (input.mode === "ask" && !conversationId) conversationId = await input.newConversation();
    if (!currentAccount()) return;
    for (const file of files) {
      if (!currentAccount()) return;
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
      setAttachments((items) => [...items, placeholder], conversationId);
      try {
        const uploaded = await uploadMistyImage(file, {
          scope: input.mode === "search" ? "visual_query" : "conversation",
          conversationId: input.mode === "ask" ? conversationId : undefined,
          onProgress: (progress) =>
            setAttachments(
              (items) => items.map((item) => (item.id === draftId ? { ...item, progress } : item)),
              conversationId,
            ),
        });
        URL.revokeObjectURL(previewUrl);
        setAttachments(
          (items) => items.map((item) => (item.id === draftId ? uploaded : item)),
          conversationId,
        );
      } catch (error) {
        if (!currentAccount()) {
          URL.revokeObjectURL(previewUrl);
          return;
        }
        setAttachments(
          (items) =>
            items.map((item) => (item.id === draftId ? { ...item, state: "failed" } : item)),
          conversationId,
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
    setAttachments(() => []);
    sent.forEach(
      (item) => item.previewUrl.startsWith("blob:") && URL.revokeObjectURL(item.previewUrl),
    );
    return sent;
  };
  const changeMode = (nextMode: GlobalAiMode) => {
    if (nextMode !== input.mode && attachments.length) {
      const stale = attachments;
      setAttachments(() => []);
      stale.forEach((attachment) => void deleteMistyImage(attachment).catch(() => undefined));
    }
    input.setMode(nextMode);
  };
  return { attachments, addFiles, remove, consume, changeMode };
}
