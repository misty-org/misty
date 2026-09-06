import type { MistyPickerSource } from "@/features/picker";
import { SocialPicker as MistyPicker } from "@/features/spaces/chat/socialRuntime";
import { MAX_CHAT_ATTACHMENTS } from "./chatDraftConstants";

/** The shared Files/Library picker, scoped to what this member may attach. */
export function SpaceChatPicker({
  spaceId,
  source,
  selectedLibraryIds,
  pendingAttachmentCount,
  canBrowseLibrary,
  canUploadAttachments,
  onClose,
  onChooseFiles,
  onChooseLibraryItems,
}: {
  spaceId: string;
  source: MistyPickerSource;
  selectedLibraryIds: string[];
  pendingAttachmentCount: number;
  canBrowseLibrary: boolean;
  canUploadAttachments: boolean;
  onClose: () => void;
  onChooseFiles: (paths: string[]) => void;
  onChooseLibraryItems: (itemIds: string[]) => void;
}) {
  return (
    <MistyPicker
      spaceId={canBrowseLibrary ? spaceId : undefined}
      initialSource={source}
      multiple
      title="Add to this chat"
      librarySelectedIds={selectedLibraryIds}
      libraryMaximum={Math.max(0, MAX_CHAT_ATTACHMENTS - pendingAttachmentCount)}
      onCancel={onClose}
      onChooseFiles={(paths) => {
        onClose();
        if (canUploadAttachments) onChooseFiles(paths);
      }}
      onChooseLibraryItems={
        canBrowseLibrary
          ? (itemIds) => {
              onChooseLibraryItems(itemIds);
              onClose();
            }
          : undefined
      }
    />
  );
}
