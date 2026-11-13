import type { MessageAttachment, SpaceLibraryItem } from "../../api/dto/entities";
import { Button, OverflowFadeText } from "@/shared/ui";
import { LibraryBig, X } from "lucide-react";

/** Removable chips for uploads and Library picks staged on the current draft. */
export function ChatAttachmentChips({
  pendingAttachments,
  selectedLibraryIds,
  libraryItems,
  onRemoveAttachment,
  onRemoveLibraryItem,
}: {
  pendingAttachments: MessageAttachment[];
  selectedLibraryIds: string[];
  libraryItems: SpaceLibraryItem[];
  onRemoveAttachment: (id: string) => void;
  onRemoveLibraryItem: (id: string) => void;
}) {
  if (pendingAttachments.length === 0 && selectedLibraryIds.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 px-3 pb-3">
      {pendingAttachments.map((attachment) => (
        <Button
          variant="secondary"
          size="sm"
          className="max-w-full"
          type="button"
          key={attachment.id}
          iconEnd={X}
          onClick={() => onRemoveAttachment(attachment.id)}
        >
          <OverflowFadeText full>{attachment.display_name}</OverflowFadeText>
        </Button>
      ))}
      {selectedLibraryIds.map((id) => (
        <Button
          variant="secondary"
          size="sm"
          className="max-w-full"
          type="button"
          key={id}
          icon={LibraryBig}
          iconEnd={X}
          onClick={() => onRemoveLibraryItem(id)}
        >
          <OverflowFadeText full>
            {libraryItems.find((item) => item.id === id)?.display_name ?? "Library item"}
          </OverflowFadeText>
        </Button>
      ))}
    </div>
  );
}
