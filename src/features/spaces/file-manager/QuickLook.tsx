import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@misty/ui";
import { FilePreview } from "./FilePreview";
import type { FileItem } from "./model";

export function QuickLook({ item, onClose }: { item: FileItem; onClose(): void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        size="media"
        aria-describedby={undefined}
        onKeyDown={(event) => {
          if (event.key !== " " || (event.target as HTMLElement).closest("input, textarea")) return;
          event.preventDefault();
          onClose();
        }}
      >
        <DialogHeader>
          <DialogTitle>{item.name}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="relative size-full min-h-0">
            <FilePreview key={item.id} item={item} />
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
