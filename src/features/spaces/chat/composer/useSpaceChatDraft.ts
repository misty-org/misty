import { spacesApi } from "../../api/api";
import type { MessageAttachment } from "../../api/dto/entities";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { readApiSessionGeneration } from "@/api/client/session";
import type { Dispatch, SetStateAction } from "react";
import type { PickedDriveFile } from "@/features/files";
import { driveFileOf } from "../../drive/driveFiles";
import type { LibraryUploadResult } from "../../api/dto/entities";
import { MAX_CHAT_ATTACHMENTS } from "./chatDraftConstants";
type DraftState = {
  text: string;
  selectedFileIds: string[];
  pendingAttachments: MessageAttachment[];
  replyToMessageId: string;
  attachmentUploading: boolean;
};
const emptyDraft = (): DraftState => ({
  text: "",
  selectedFileIds: [],
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
      setPendingAttachments: setter("pendingAttachments"),
      setReplyToMessageId: setter("replyToMessageId"),
      setAttachmentUploading: setter("attachmentUploading"),
    };
  }, [key, session]);
  const {
    text,
    selectedFileIds,
    pendingAttachments,
    replyToMessageId,
    attachmentUploading,
  } = state;
  const {
    setText,
    setSelectedFileIds,
    setPendingAttachments,
    setReplyToMessageId,
    setAttachmentUploading,
  } = setters;
  const attachmentSlotsLeft = Math.max(0, MAX_CHAT_ATTACHMENTS - pendingAttachments.length);
  const reset = useCallback(() => {
    setText("");
    setSelectedFileIds([]);
    setPendingAttachments([]);
    setReplyToMessageId("");
  }, [setText, setSelectedFileIds, setPendingAttachments, setReplyToMessageId]);
  /** Uploads each as an attachment, in turn, up to the slots left. */
  const upload = useCallback(
    async (sends: Array<(conversationId?: string) => Promise<LibraryUploadResult>>) => {
      if (sends.length === 0 || attachmentUploading || attachmentSlotsLeft === 0) return;
      setAttachmentUploading(true);
      try {
        const uploaded: MessageAttachment[] = [];
        for (const send of sends.slice(0, attachmentSlotsLeft)) {
          if (session !== readApiSessionGeneration()) return;
          const result = await send(conversationId || undefined);
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
  const uploadAttachments = useCallback(
    (paths: string[]) =>
      upload(
        paths.map(
          (path) => (conversation?: string) =>
            spacesApi.uploadLibraryPath(spaceId, path, "attachment", {
              conversationId: conversation,
            }),
        ),
      ),
    [spaceId, upload],
  );
  /** Files of the Space's drive, read from it on this computer and sent as attachments. */
  const attachDriveFiles = useCallback(
    (files: PickedDriveFile[]) =>
      upload(
        files.map((file) => async (conversation?: string) => {
          const content = await driveFileOf(file);
          return spacesApi.uploadLibraryBlob(spaceId, content, content.name, "attachment", {
            conversationId: conversation,
          });
        }),
      ),
    [spaceId, upload],
  );
  return useMemo(
    () => ({
      text,
      setText,
      selectedFileIds,
      setSelectedFileIds,
      pendingAttachments,
      setPendingAttachments,
      replyToMessageId,
      setReplyToMessageId,
      attachmentUploading,
      attachmentSlotsLeft,
      isEmpty: !text.trim() && pendingAttachments.length === 0,
      reset,
      uploadAttachments,
      attachDriveFiles,
    }),
    [
      setText,
      setSelectedFileIds,
      setPendingAttachments,
      setReplyToMessageId,
      attachmentSlotsLeft,
      attachmentUploading,
      pendingAttachments,
      replyToMessageId,
      reset,
      selectedFileIds,
      text,
      uploadAttachments,
      attachDriveFiles,
    ],
  );
}
export type SpaceChatDraft = ReturnType<typeof useSpaceChatDraft>;
