import { spacesApi } from "../../api/api";
import type { MessageAttachment } from "../../api/dto/entities";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { readApiSessionGeneration } from "@/api/client/session";
import type { Dispatch, SetStateAction } from "react";
import type { PickedDriveFile } from "@/features/files";
import { driveFileOf } from "../../drive/drive_files";
import type { LibraryUploadResult } from "../../api/dto/entities";
import { MAX_CHAT_ATTACHMENTS } from "./chat_draft_constants";
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
  const { text, selectedFileIds, pendingAttachments, replyToMessageId, attachmentUploading } =
    state;
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
  const discard = useCallback(
    (attachments: MessageAttachment[]) => {
      if (session !== readApiSessionGeneration()) return;
      for (const attachment of attachments)
        void spacesApi
          .discardUnsentAttachment(spaceId, attachment.upload_id)
          .catch(() => undefined);
    },
    [session, spaceId],
  );
  const removeAttachment = useCallback(
    (attachment: MessageAttachment) => {
      setPendingAttachments((current) => current.filter((item) => item.id !== attachment.id));
      discard([attachment]);
    },
    [discard, setPendingAttachments],
  );
  const upload = useCallback(
    async (sends: Array<(conversationId?: string) => Promise<LibraryUploadResult>>) => {
      if (sends.length === 0 || attachmentUploading || attachmentSlotsLeft === 0) return;
      setAttachmentUploading(true);
      const uploaded: MessageAttachment[] = [];
      try {
        for (const send of sends.slice(0, attachmentSlotsLeft)) {
          if (session !== readApiSessionGeneration()) return;
          const result = await send(conversationId || undefined);
          if (session !== readApiSessionGeneration()) return;
          if (result.attachment) uploaded.push(result.attachment);
        }
        setPendingAttachments((current) => [...current, ...uploaded]);
      } catch (error) {
        discard(uploaded);
        throw error;
      } finally {
        setAttachmentUploading(false);
      }
    },
    [
      session,
      attachmentSlotsLeft,
      attachmentUploading,
      conversationId,
      discard,
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
  const attachFiles = useCallback(
    (files: File[]) =>
      upload(
        files.map(
          (file) => (conversation?: string) =>
            spacesApi.uploadLibraryBlob(spaceId, file, file.name, "attachment", {
              conversationId: conversation,
            }),
        ),
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
      removeAttachment,
      replyToMessageId,
      setReplyToMessageId,
      attachmentUploading,
      attachmentSlotsLeft,
      isEmpty: !text.trim() && pendingAttachments.length === 0,
      reset,
      uploadAttachments,
      attachDriveFiles,
      attachFiles,
    }),
    [
      setText,
      setSelectedFileIds,
      setPendingAttachments,
      setReplyToMessageId,
      attachmentSlotsLeft,
      attachmentUploading,
      pendingAttachments,
      removeAttachment,
      replyToMessageId,
      reset,
      selectedFileIds,
      text,
      uploadAttachments,
      attachDriveFiles,
      attachFiles,
    ],
  );
}
export type SpaceChatDraft = ReturnType<typeof useSpaceChatDraft>;
