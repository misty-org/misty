import { useState } from "react";
import { spacesApi } from "@/stores/spaces/useSpacesBackendStore";
import type { MessageAttachment } from "@/models/interfaces/features/spaces/types";

export const MAX_CHAT_ATTACHMENTS = 5;

/**
 * Everything the composer is holding but has not sent yet.
 *
 * Attachments and Library picks share one budget, so `attachmentSlotsLeft` is
 * the single number every add path checks before offering more.
 */
export function useSpaceChatDraft(spaceId: string, conversationId = "") {
  const [text, setText] = useState("");
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [selectedLibraryIds, setSelectedLibraryIds] = useState<string[]>([]);
  const [pendingAttachments, setPendingAttachments] = useState<MessageAttachment[]>([]);
  const [replyToMessageId, setReplyToMessageId] = useState("");
  const [selectedAgentIdsByLabel, setSelectedAgentIdsByLabel] = useState<Record<string, string>>(
    {},
  );
  const [attachmentUploading, setAttachmentUploading] = useState(false);

  const attachmentSlotsLeft = Math.max(
    0,
    MAX_CHAT_ATTACHMENTS - pendingAttachments.length - selectedLibraryIds.length,
  );

  const reset = () => {
    setText("");
    setSelectedFileIds([]);
    setSelectedLibraryIds([]);
    setPendingAttachments([]);
    setReplyToMessageId("");
    setSelectedAgentIdsByLabel({});
  };

  const uploadAttachments = async (paths: string[]) => {
    if (paths.length === 0 || attachmentUploading || attachmentSlotsLeft === 0) return;
    setAttachmentUploading(true);
    try {
      const uploaded: MessageAttachment[] = [];
      for (const path of paths.slice(0, attachmentSlotsLeft)) {
        const result = await spacesApi.uploadLibraryPath(spaceId, path, "attachment", {
          conversationId: conversationId || undefined,
        });
        if (result.attachment) uploaded.push(result.attachment);
      }
      setPendingAttachments((current) => [...current, ...uploaded]);
    } finally {
      setAttachmentUploading(false);
    }
  };

  return {
    text,
    setText,
    selectedFileIds,
    setSelectedFileIds,
    selectedLibraryIds,
    setSelectedLibraryIds,
    pendingAttachments,
    setPendingAttachments,
    replyToMessageId,
    setReplyToMessageId,
    selectedAgentIdsByLabel,
    setSelectedAgentIdsByLabel,
    attachmentUploading,
    attachmentSlotsLeft,
    isEmpty: !text.trim() && pendingAttachments.length === 0 && selectedLibraryIds.length === 0,
    reset,
    uploadAttachments,
  };
}

export type SpaceChatDraft = ReturnType<typeof useSpaceChatDraft>;
