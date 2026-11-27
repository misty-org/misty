import type { MistyPickerSource, PickedDriveFile } from "@/features/files";
import { FilePickDialog, type FileItem } from "../../file-manager";
import { localPath } from "../../file-manager/model";
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
  const room = Math.max(0, MAX_CHAT_ATTACHMENTS - pendingAttachmentCount);
  const choose = (items: FileItem[]) => {
    if (items.length > room)
      throw new Error(
        room
          ? `Add up to ${room} more file${room === 1 ? "" : "s"} here.`
          : "This message is full.",
      );
    const paths: string[] = [];
    const drive: PickedDriveFile[] = [];
    for (const item of items) {
      const path = localPath(item);
      if (path) paths.push(path);
      else if (item.source.kind === "drive" && item.source.entry.space_id === spaceId)
        drive.push(item.source.entry);
      else throw new Error(`${item.name} isn't in this Space's Files or on this computer.`);
    }
    if (drive.length && !canBrowseDrive)
      throw new Error("Files from this Space can't be added here.");
    onClose();
    if (!canUploadAttachments) return;
    if (paths.length) onChooseFiles(paths);
    if (drive.length) onChooseDriveFiles(drive);
  };
  return (
    <FilePickDialog
      choice={{
        title: "Add to this chat",
        multiple: true,
        start:
          source === "space" && canBrowseDrive
            ? { kind: "space-drive", spaceId, path: "/" }
            : undefined,
      }}
      onPick={choose}
      onCancel={onClose}
    />
  );
}
