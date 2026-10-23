import type { LibraryItemViewerProps } from "./model/libraryViewerTypes";
import type { SpaceLibraryItem } from "@/api/spaces/dto/entities";
import { cn, Dialog, DialogContent, DialogDescription, DialogTitle } from "@/shared/ui";
import { useState } from "react";
import { copyLibraryItemsToClipboard } from "./libraryClipboard";
import { libraryMediaKind } from "./libraryViewer/libraryMediaKind";
import { LibraryPhotoEditorView } from "./libraryViewer/LibraryPhotoEditorView";
import { LibraryViewerSidebar } from "./libraryViewer/LibraryViewerSidebar";
import { LibraryViewerStage } from "./libraryViewer/LibraryViewerStage";
import { LibraryViewerToolbar } from "./libraryViewer/LibraryViewerToolbar";
import { useLibraryEditActions } from "./libraryViewer/useLibraryEditActions";
import { useLibraryEditVersions } from "./libraryViewer/useLibraryEditVersions";
import { useLibraryItemContent } from "./libraryViewer/useLibraryItemContent";
import { useLibraryViewerKeyboard } from "./libraryViewer/useLibraryViewerKeyboard";
import { useLibraryViewerPlayback } from "./libraryViewer/useLibraryViewerPlayback";
import { libraryItemMIME } from "./SpaceLibraryPrimitives";
import { libraryEditStyle, normalizeLibraryEdit } from "./SpaceLibraryViewerUtils";
const dialogClass =
  "grid h-[min(860px,calc(100dvh-32px))] min-h-0 w-[min(1320px,calc(100vw-32px))] max-w-none grid-cols-[minmax(0,1fr)_minmax(300px,340px)] grid-rows-[56px_minmax(0,1fr)] gap-0 overflow-hidden rounded-xl border-charcoal-border/80 bg-charcoal-bg p-0 shadow-lg sm:max-w-none [&>button]:hidden";
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
  const [editing, setEditing] = useState(false);
  const index = items.findIndex((candidate) => candidate.id === item.id);
  const mimeType = libraryItemMIME(item);
  const metadata = item.file.intrinsic_metadata;
  const { isImage, isVideo } = libraryMediaKind(mimeType, metadata);
  const versions = useLibraryEditVersions({
    spaceId,
    item,
    editable: isImage || isVideo,
    onRenditionReady: props.onRenditionReady,
  });
  const { activeEdit, editVersions, editDraft, setEditDraft } = versions;
  const appliedEdit = editing ? editDraft : normalizeLibraryEdit(activeEdit?.edit_definition);
  const renditionReady = activeEdit?.rendition_state === "ready";
  const content = useLibraryItemContent({
    spaceId,
    item,
    editing,
    itemIsImage: isImage,
    renditionState: activeEdit?.rendition_state,
  });
  const edits = useLibraryEditActions({
    spaceId,
    item,
    canEdit,
    isImage,
    editing,
    setEditing,
    editVersions,
    setEditVersions: versions.setEditVersions,
    editDraft,
    setEditDraft,
    onReplaceItem: props.onReplaceItem,
    onRenditionReady: props.onRenditionReady,
  });
  const playback = useLibraryViewerPlayback({ appliedEdit });
  const goPrevious = () => index > 0 && onSelect(items[index - 1].id);
  const goNext = () => index >= 0 && index < items.length - 1 && onSelect(items[index + 1].id);
  useLibraryViewerKeyboard({
    enabled: !isImage,
    index,
    itemCount: items.length,
    onClose,
    onPrevious: goPrevious,
    onNext: goNext,
  });
  const copyItem = async (target: SpaceLibraryItem = item) => {
    if (!canCopy) return;
    edits.setEditError("");
    try {
      await copyLibraryItemsToClipboard(spaceId, [target]);
    } catch (error) {
      edits.setEditError(
        error instanceof Error ? error.message : "The Library item could not be copied.",
      );
    }
  };
  if (isImage)
    return (
      <LibraryPhotoEditorView
        spaceId={spaceId}
        item={item}
        mimeType={mimeType}
        contentUrl={content.contentUrl}
        contentLoading={content.contentLoading}
        contentError={content.contentError}
        indexLabel={`${index + 1} of ${items.length}`}
        canEdit={canEdit}
        onClose={onClose}
        onReplaceItem={props.onReplaceItem}
        onRenditionReady={props.onRenditionReady}
      />
    );
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
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
        <header
          className={cn(
            "relative z-20 flex min-w-0 items-center justify-between gap-4 border-b border-charcoal-border/60 bg-charcoal-bg px-4",
            "col-span-2",
          )}
        >
          <div className="min-w-0">
            <DialogTitle className="truncate text-sm font-medium">{item.display_name}</DialogTitle>
            <DialogDescription className="sr-only">
              Preview and edit {item.display_name}.
            </DialogDescription>
            <p className="m-0 mt-0.5 text-[10px] text-cream-muted">
              {index + 1} of {items.length}
            </p>
          </div>
          <div className="flex min-w-0 items-center gap-1 overflow-hidden">
            {null}
            <LibraryViewerToolbar
              item={item}
              activeEdit={activeEdit}
              renditionReady={renditionReady}
              canEdit={canEdit}
              canCopy={canCopy}
              editing={editing}
              editSaving={edits.editSaving}
              editingAvailable={versions.editingAvailable}
              onCopyEdit={() => props.onCopyEdit(normalizeLibraryEdit(activeEdit?.edit_definition))}
              onSaveAsCopy={() => void edits.saveAsCopy()}
              onSaveEdit={() => void edits.saveEdit()}
              onBeginEditing={() => {
                if (!canEdit) return;
                setEditDraft(normalizeLibraryEdit(activeEdit?.edit_definition));
                setEditing(true);
                edits.setEditError("");
              }}
              onCopyItem={() => void copyItem()}
              onTrash={() => void props.onTrash(item)}
            />
          </div>
        </header>

        <LibraryViewerStage
          displayName={item.display_name}
          mimeType={mimeType}
          contentUrl={content.contentUrl}
          contentLoading={content.contentLoading}
          contentError={content.contentError}
          mediaStyle={renditionReady && !editing ? undefined : libraryEditStyle(appliedEdit)}
          canCopy={canCopy}
          index={index}
          itemCount={items.length}
          imageRef={playback.imageRef}
          videoRef={playback.videoRef}
          onVideoTime={playback.handleVideoTime}
          onCopy={() => void copyItem()}
          onPrevious={goPrevious}
          onNext={goNext}
        />

        {
          <LibraryViewerSidebar
            item={item}
            mimeType={mimeType}
            canEdit={canEdit}
            isImage={isImage}
            isVideo={isVideo}
            durationSeconds={Number(metadata.duration ?? 1)}
            editing={editing}
            editDraft={editDraft}
            setEditDraft={setEditDraft}
            editSaving={edits.editSaving}
            editError={edits.editError}
            editingAvailable={versions.editingAvailable}
            editVersions={editVersions}
            activeEdit={activeEdit}
            onUpdate={props.onUpdate}
            onCancelEdit={() => {
              setEditing(false);
              setEditDraft(normalizeLibraryEdit(activeEdit?.edit_definition));
            }}
            onSaveEdit={() => void edits.saveEdit()}
            onSelectVersion={(editID) => void edits.selectEdit(editID)}
            onRenderVersion={(editID) => void edits.renderEdit(editID)}
            onDeleteVersion={(editID) => void edits.deleteEdit(editID)}
          />
        }
        {null}
      </DialogContent>
    </Dialog>
  );
}
