import type { MistyPickerSource, PickedDriveFile } from "@/features/files";
import { MistyPicker } from "@/features/files";
import { MAX_CHAT_ATTACHMENTS } from "./chat_draft_constants";

export function SpaceChatPicker({
  spaceId,
  source,
  pendingAttachmentCount,
  canBrowseDrive,
  canUploadAttachments,
  onClose,
  onChooseFiles,
  onChooseDriveFiles,
}: {
  spaceId: string;
  source: MistyPickerSource;
  pendingAttachmentCount: number;
  canBrowseDrive: boolean;
  canUploadAttachments: boolean;
  onClose: () => void;
  onChooseFiles: (paths: string[]) => void;
  onChooseDriveFiles: (files: PickedDriveFile[]) => void;
}) {
  return (
    <MistyPicker
      spaceId={canBrowseDrive ? spaceId : undefined}
      initialSource={source}
      multiple
      title="Add to this chat"
      driveMaximum={Math.max(0, MAX_CHAT_ATTACHMENTS - pendingAttachmentCount)}
      onCancel={onClose}
      onChooseFiles={(paths) => {
        onClose();
        if (canUploadAttachments) onChooseFiles(paths);
      }}
      onChooseDriveFiles={
        canBrowseDrive && canUploadAttachments
          ? (files) => {
              onClose();
              onChooseDriveFiles(files);
            }
          : undefined
      }
    />
  );
}
