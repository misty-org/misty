import { LibraryBig, X } from "lucide-react";
import { Button } from "@/ui";
import type {
  MessageAttachment,
  SpaceLibraryItem,
} from "@/models/interfaces/features/spaces/types";

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
          className="h-7 max-w-full"
          type="button"
          key={attachment.id}
          onClick={() => onRemoveAttachment(attachment.id)}
        >
          <span className="truncate">{attachment.display_name}</span>
          <X />
        </Button>
      ))}
      {selectedLibraryIds.map((id) => (
        <Button
          variant="secondary"
          size="sm"
          className="h-7 max-w-full"
          type="button"
          key={id}
          onClick={() => onRemoveLibraryItem(id)}
        >
          <LibraryBig />
          <span className="truncate">
            {libraryItems.find((item) => item.id === id)?.display_name ?? "Library item"}
          </span>
          <X />
        </Button>
      ))}
    </div>
  );
}
