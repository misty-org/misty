import { spacesApi } from "@/api/spaces/api";
import type { MessageAttachment } from "@/api/spaces/dto/interfaces/types";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { readApiSessionGeneration } from "@/api/client/session";
import type { Dispatch, SetStateAction } from "react";
import { MAX_CHAT_ATTACHMENTS } from "./chatDraftConstants";
export { MAX_CHAT_ATTACHMENTS } from "./chatDraftConstants";

type DraftState = {
  text: string;
  selectedFileIds: string[];
  selectedLibraryIds: string[];
  pendingAttachments: MessageAttachment[];
  replyToMessageId: string;
  attachmentUploading: boolean;
};
const emptyDraft = (): DraftState => ({
  text: "",
  selectedFileIds: [],
  selectedLibraryIds: [],
  pendingAttachments: [],
  replyToMessageId: "",
  attachmentUploading: false,
});
const emptySnapshot = emptyDraft();
const drafts = new Map<string, DraftState>();
const listeners = new Set<() => void>();
let generation = -1;
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Session memory keeps unsent content per conversation, never across account changes. */
export function useSpaceChatDraft(spaceId: string, conversationId = "") {
  const session = readApiSessionGeneration();
  if (session !== generation) {
    drafts.clear();
    generation = session;
  }
  const key = JSON.stringify([session, spaceId, conversationId]);
  if (!drafts.has(key)) drafts.set(key, emptyDraft());
  const state = useSyncExternalStore(subscribe, () => drafts.get(key) ?? emptySnapshot);
  const setters = useMemo(() => {
    const setter =
      <K extends keyof DraftState>(field: K): Dispatch<SetStateAction<DraftState[K]>> =>
      (value) => {
        if (readApiSessionGeneration() !== session) return;
        const current = drafts.get(key) ?? emptyDraft();
        const next =
          typeof value === "function"
            ? (value as (old: DraftState[K]) => DraftState[K])(current[field])
            : value;
        drafts.set(key, { ...current, [field]: next });
        listeners.forEach((listener) => listener());
      };
    return {
      setText: setter("text"),
      setSelectedFileIds: setter("selectedFileIds"),
      setSelectedLibraryIds: setter("selectedLibraryIds"),
      setPendingAttachments: setter("pendingAttachments"),
      setReplyToMessageId: setter("replyToMessageId"),
      setAttachmentUploading: setter("attachmentUploading"),
    };
  }, [key, session]);
  const {
    text,
    selectedFileIds,
    selectedLibraryIds,
    pendingAttachments,
    replyToMessageId,
    attachmentUploading,
  } = state;
  const {
    setText,
    setSelectedFileIds,
    setSelectedLibraryIds,
    setPendingAttachments,
    setReplyToMessageId,
    setAttachmentUploading,
  } = setters;
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
  }, [
    setText,
    setSelectedFileIds,
    setSelectedLibraryIds,
    setPendingAttachments,
    setReplyToMessageId,
  ]);
  const uploadAttachments = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0 || attachmentUploading || attachmentSlotsLeft === 0) return;
      setAttachmentUploading(true);
      try {
        const uploaded: MessageAttachment[] = [];
        for (const path of paths.slice(0, attachmentSlotsLeft)) {
          if (session !== readApiSessionGeneration()) return;
          const result = await spacesApi.uploadLibraryPath(spaceId, path, "attachment", {
            conversationId: conversationId || undefined,
          });
          if (session !== readApiSessionGeneration()) return;
          if (result.attachment) uploaded.push(result.attachment);
        }
        setPendingAttachments((current) => [...current, ...uploaded]);
      } finally {
        setAttachmentUploading(false);
      }
    },
    [
      session,
      attachmentSlotsLeft,
      attachmentUploading,
      conversationId,
      spaceId,
      setAttachmentUploading,
      setPendingAttachments,
    ],
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
      attachmentUploading,
      attachmentSlotsLeft,
      isEmpty: !text.trim() && pendingAttachments.length === 0 && selectedLibraryIds.length === 0,
      reset,
      uploadAttachments,
    }),
    [
      setText,
      setSelectedFileIds,
      setSelectedLibraryIds,
      setPendingAttachments,
      setReplyToMessageId,
      attachmentSlotsLeft,
      attachmentUploading,
      pendingAttachments,
      replyToMessageId,
      reset,
      selectedFileIds,
      selectedLibraryIds,
      text,
      uploadAttachments,
    ],
  );
}
export type SpaceChatDraft = ReturnType<typeof useSpaceChatDraft>;
