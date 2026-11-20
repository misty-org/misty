import type { LibraryItemViewerProps } from "./library-viewer/libraryViewerTypes";
import type { SpaceLibraryItem } from "../api/dto/entities";
import {
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  OverflowFadeText,
  Surface,
  Text,
} from "@misty/ui";
import { useState } from "react";
import { copyLibraryItemsToClipboard } from "./libraryClipboard";
import { libraryMediaKind } from "./library-viewer/libraryMediaKind";
import { LibraryViewerSidebar } from "./library-viewer/LibraryViewerSidebar";
import { LibraryViewerStage } from "./library-viewer/LibraryViewerStage";
import { LibraryViewerToolbar } from "./library-viewer/LibraryViewerToolbar";
import {
  useLibraryItemContent,
  usePrefetchLibraryNeighbors,
} from "./library-viewer/useLibraryItemContent";
import { useLibraryViewerKeyboard } from "./library-viewer/useLibraryViewerKeyboard";
import { libraryItemMIME } from "./SpaceLibraryPrimitives";
const dialogClass = [
  "grid h-[min(53.75rem,calc(100dvh-2rem))] min-h-0 w-[min(82.5rem,calc(100vw-2rem))] max-w-none",
  "grid-cols-[minmax(0,1fr)_minmax(18.75rem,21.25rem)] grid-rows-[3.5rem_minmax(0,1fr)] gap-0 overflow-hidden",
  "rounded-xl p-0 sm:max-w-none [&>button]:hidden",
].join(" ");

/**
 * A file of the Space, previewed over Files as Preview shows it: the file, its details, and the
 * arrows to step through the rest. Editing a file is an app's job: one the Space added opens it.
 */
export function SpaceLibraryViewer(props: LibraryItemViewerProps) {
  if (!props.item) return null;
  return <LibraryItemViewerContent {...props} item={props.item} />;
}
function LibraryItemViewerContent(
  props: LibraryItemViewerProps & {
    item: SpaceLibraryItem;
  },
) {
  const { spaceId, item, items } = props;
  const { canEdit, canCopy, onClose, onSelect } = props;
  const [copyError, setCopyError] = useState("");
  const index = items.findIndex((candidate) => candidate.id === item.id);
  const mimeType = libraryItemMIME(item);
  const { isImage } = libraryMediaKind(mimeType, item.file.intrinsic_metadata);
  const content = useLibraryItemContent({ spaceId, item, itemIsImage: isImage });
  usePrefetchLibraryNeighbors({
    spaceId,
    items,
    index,
    ready: isImage && Boolean(content.contentUrl),
  });
  const goPrevious = () => index > 0 && onSelect(items[index - 1].id);
  const goNext = () => index >= 0 && index < items.length - 1 && onSelect(items[index + 1].id);
  useLibraryViewerKeyboard({
    enabled: true,
    index,
    itemCount: items.length,
    onClose,
    onPrevious: goPrevious,
    onNext: goNext,
  });
  const copyItem = async (target: SpaceLibraryItem = item) => {
    if (!canCopy) return;
    setCopyError("");
    try {
      await copyLibraryItemsToClipboard(spaceId, [target]);
    } catch (error) {
      setCopyError(error instanceof Error ? error.message : "The file could not be copied.");
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        tone="page"
        className={cn(dialogClass)}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          props.returnFocusRef.current?.focus();
        }}
        onKeyDown={(event) => {
          const target = event.target as HTMLElement | null;
          if (
            (event.metaKey || event.ctrlKey) &&
            event.key.toLowerCase() === "c" &&
            !target?.matches("input, textarea, select, [contenteditable='true']")
          ) {
            event.preventDefault();
            void copyItem();
          }
        }}
      >
        <Surface
          as="header"
          tone="page"
          className="relative z-20 col-span-2 flex min-w-0 items-center justify-between gap-4 border-b px-4"
        >
          <div className="min-w-0">
            <DialogTitle className="text-sm font-medium">
              <OverflowFadeText full>{item.display_name}</OverflowFadeText>
            </DialogTitle>
            <DialogDescription className="sr-only">Preview {item.display_name}.</DialogDescription>
            <Text as="p" tone={copyError ? "danger" : "muted"} className="m-0 mt-0.5 text-3xs">
              {copyError || `${index + 1} of ${items.length}`}
            </Text>
          </div>
          <div className="flex min-w-0 items-center gap-1 overflow-hidden">
            <LibraryViewerToolbar
              canEdit={canEdit}
              canCopy={canCopy}
              onCopyItem={() => void copyItem()}
              onTrash={() => void props.onTrash(item)}
            />
          </div>
        </Surface>

        <LibraryViewerStage
          displayName={item.display_name}
          mimeType={mimeType}
          contentUrl={content.contentUrl}
          contentLoading={content.contentLoading}
          contentError={content.contentError}
          canCopy={canCopy}
          index={index}
          itemCount={items.length}
          onCopy={() => void copyItem()}
          onPrevious={goPrevious}
          onNext={goNext}
        />

        <LibraryViewerSidebar
          item={item}
          mimeType={mimeType}
          canEdit={canEdit}
          onUpdate={props.onUpdate}
        />
      </DialogContent>
    </Dialog>
  );
}
