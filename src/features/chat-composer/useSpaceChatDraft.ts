import { spacesApi } from "@/api/spaces/api";
import type { MessageAttachment } from "@/api/spaces/dto/interfaces/types";
import { readActiveSavedAccountSession } from "@/features/auth";
import type { MobileChatDraftRecord } from "@/native/contracts";
import { mobileCacheRead, mobileCacheRemove, mobileCacheWrite } from "@/native/mobile-cache";
import { isNativeMobileBuild } from "@/shared/platform/buildTarget";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { useCallback, useEffect, useMemo, useState } from "react";

export { MAX_CHAT_ATTACHMENTS } from "./chatDraftConstants";
import { MAX_CHAT_ATTACHMENTS } from "./chatDraftConstants";

/** Everything the composer is holding but has not sent yet. */
export function useSpaceChatDraft(spaceId: string, conversationId = "") {
  const accountId = readActiveSavedAccountSession()?.id ?? "";
  const recordKey = `chat-draft:${spaceId}:${conversationId || "space"}`;
  const [hydratedRecordKey, setHydratedRecordKey] = useState("");
  const [text, setText] = useState("");
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [selectedLibraryIds, setSelectedLibraryIds] = useState<string[]>([]);
  const [pendingAttachments, setPendingAttachments] = useState<MessageAttachment[]>([]);
  const [replyToMessageId, setReplyToMessageId] = useState("");
  const [selectedAgentIdsByLabel, setSelectedAgentIdsByLabel] = useState<Record<string, string>>(
    {},
  );
  const [attachmentUploading, setAttachmentUploading] = useState(false);

  useEffect(() => {
    if (!isNativeMobileBuild || !hasTauriInternals() || !accountId || !spaceId) return;
    let active = true;
    setHydratedRecordKey("");
    void mobileCacheRead<MobileChatDraftRecord>(accountId, recordKey)
      .then((saved) => {
        if (!active || !saved || saved.schemaVersion !== 1 || saved.accountId !== accountId) return;
        setText(saved.text);
        setSelectedFileIds(saved.selectedFileIds);
        setSelectedLibraryIds(saved.selectedLibraryIds);
        setPendingAttachments(saved.pendingAttachments);
        setReplyToMessageId(saved.replyToMessageId);
        setSelectedAgentIdsByLabel(saved.selectedAgentIdsByLabel);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setHydratedRecordKey(recordKey);
      });
    return () => {
      active = false;
    };
  }, [accountId, recordKey, spaceId]);

  useEffect(() => {
    if (hydratedRecordKey !== recordKey || !accountId) return;
    const timer = window.setTimeout(() => {
      const empty =
        !text.trim() && pendingAttachments.length === 0 && selectedLibraryIds.length === 0;
      if (empty) {
        void mobileCacheRemove(accountId, recordKey);
        return;
      }
      const record: MobileChatDraftRecord = {
        schemaVersion: 1,
        kind: "chat-draft",
        accountId,
        updatedAt: new Date().toISOString(),
        spaceId,
        conversationId,
        text,
        selectedFileIds,
        selectedLibraryIds,
        pendingAttachments,
        replyToMessageId,
        selectedAgentIdsByLabel,
      };
      void mobileCacheWrite(accountId, recordKey, record);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [
    accountId,
    conversationId,
    hydratedRecordKey,
    pendingAttachments,
    recordKey,
    replyToMessageId,
    selectedAgentIdsByLabel,
    selectedFileIds,
    selectedLibraryIds,
    spaceId,
    text,
  ]);

  const attachmentSlotsLeft = Math.max(
    0,
    MAX_CHAT_ATTACHMENTS - pendingAttachments.length - selectedLibraryIds.length,
  );

  const reset = useCallback(() => {
    setText("");
    setSelectedFileIds([]);
    setSelectedLibraryIds([]);
    setPendingAttachments([]);
    setReplyToMessageId("");
    setSelectedAgentIdsByLabel({});
  }, []);

  const uploadAttachments = useCallback(
    async (paths: string[]) => {
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
    },
    [attachmentSlotsLeft, attachmentUploading, conversationId, spaceId],
  );

  return useMemo(
    () => ({
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
    }),
    [
      attachmentSlotsLeft,
      attachmentUploading,
      pendingAttachments,
      replyToMessageId,
      reset,
      selectedAgentIdsByLabel,
      selectedFileIds,
      selectedLibraryIds,
      text,
      uploadAttachments,
    ],
  );
}

export type SpaceChatDraft = ReturnType<typeof useSpaceChatDraft>;
