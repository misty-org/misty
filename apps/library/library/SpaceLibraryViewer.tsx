import type { LibraryItemViewerProps } from "@/api/spaces/dto/interfaces/SpaceLibraryViewer";
import type { SpaceLibraryItem } from "@/api/spaces/dto/interfaces/types";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  cn,
} from "@/shared/ui";
import { useSurfacePresentation } from "@/shared/mobile";
import { Info } from "lucide-react";
import { useState } from "react";
import { libraryItemMIME } from "./SpaceLibraryPrimitives";
import { libraryEditStyle, normalizeLibraryEdit } from "./SpaceLibraryViewerUtils";
import { copyLibraryItemsToClipboard } from "./libraryClipboard";
import { LibraryPhotoEditorView } from "./libraryViewer/LibraryPhotoEditorView";
import { LibraryViewerSidebar } from "./libraryViewer/LibraryViewerSidebar";
import { LibraryViewerStage } from "./libraryViewer/LibraryViewerStage";
import { LibraryViewerToolbar } from "./libraryViewer/LibraryViewerToolbar";
import { libraryMediaKind } from "./libraryViewer/libraryMediaKind";
import { useLibraryEditActions } from "./libraryViewer/useLibraryEditActions";
import { useLibraryEditVersions } from "./libraryViewer/useLibraryEditVersions";
import { useLibraryItemContent } from "./libraryViewer/useLibraryItemContent";
import { useLibraryStackMedia } from "./libraryViewer/useLibraryStackMedia";
import { useLibraryViewerKeyboard } from "./libraryViewer/useLibraryViewerKeyboard";
import { useLibraryViewerPlayback } from "./libraryViewer/useLibraryViewerPlayback";

const dialogClass =
  "grid h-[min(860px,calc(100dvh-32px))] min-h-0 w-[min(1320px,calc(100vw-32px))] max-w-none grid-cols-[minmax(0,1fr)_minmax(300px,340px)] grid-rows-[56px_minmax(0,1fr)] gap-0 overflow-hidden rounded-xl border-charcoal-border/80 bg-charcoal-bg p-0 shadow-lg sm:max-w-none [&>button]:hidden";

export function LibraryItemViewer(props: LibraryItemViewerProps) {
  if (!props.item) return null;
  return <LibraryItemViewerContent {...props} item={props.item} />;
}

function LibraryItemViewerContent(props: LibraryItemViewerProps & { item: SpaceLibraryItem }) {
  const mobile = useSurfacePresentation() !== "desktop";
  const { spaceId, item, items, allItems, assetStack, reauthenticationToken } = props;
  const { canEdit, canCopy, onClose, onSelect } = props;
  const [editing, setEditing] = useState(false);
  const [metadataOpen, setMetadataOpen] = useState(false);

  const index = items.findIndex((candidate) => candidate.id === item.id);
  const mimeType = libraryItemMIME(item);
  const metadata = item.file.intrinsic_metadata;
  const { isImage, isVideo } = libraryMediaKind(mimeType, metadata);

  const versions = useLibraryEditVersions({
    spaceId,
    item,
    reauthenticationToken,
    editable: isImage || isVideo,
    onRenditionReady: props.onRenditionReady,
  });
  const { activeEdit, editVersions, editDraft, setEditDraft } = versions;
  const appliedEdit = editing ? editDraft : normalizeLibraryEdit(activeEdit?.edit_definition);
  const renditionReady = activeEdit?.rendition_state === "ready";

  const stack = useLibraryStackMedia({ item, allItems, assetStack });
  const content = useLibraryItemContent({
    spaceId,
    item,
    assetStack,
    reauthenticationToken,
    editing,
    itemIsImage: isImage,
    stackMediaID: stack.stackMediaID,
    stackMediaIsImage: stack.isImage,
    stackMediaMIME: stack.stackMediaMIME,
    stackMediaVersion: stack.stackMediaItem?.version,
    renditionState: activeEdit?.rendition_state,
  });

  const edits = useLibraryEditActions({
    spaceId,
    item,
    reauthenticationToken,
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

  const playback = useLibraryViewerPlayback({ appliedEdit, assetStack });
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
      await copyLibraryItemsToClipboard(spaceId, [target], reauthenticationToken);
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
        className={cn(
          mobile
            ? "inset-0 grid h-dvh max-h-dvh w-screen max-w-none translate-x-0 translate-y-0 grid-cols-1 grid-rows-[56px_minmax(0,1fr)] gap-0 overflow-hidden rounded-none border-0 bg-charcoal-bg p-0 [&>button]:hidden"
            : dialogClass,
        )}
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
            !mobile && "col-span-2",
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
            {mobile ? (
              <Button
                className="size-11 shrink-0"
                size="icon"
                variant="outline"
                onClick={() => setMetadataOpen(true)}
                aria-label="Item details"
              >
                <Info className="size-4" />
              </Button>
            ) : null}
            <LibraryViewerToolbar
              item={item}
              assetStack={assetStack}
              stackMediaID={stack.stackMediaID}
              stackMemberRole={stack.stackMediaMember?.role}
              activeEdit={activeEdit}
              renditionReady={renditionReady}
              canEdit={canEdit}
              canCopy={canCopy}
              editing={editing}
              editSaving={edits.editSaving}
              editingAvailable={versions.editingAvailable}
              onSetStackCover={() =>
                assetStack && void props.onSetStackCover(assetStack, stack.stackMediaID)
              }
              onUngroupStack={() => assetStack && void props.onUngroupStack(assetStack)}
              onCopyEdit={() => props.onCopyEdit(normalizeLibraryEdit(activeEdit?.edit_definition))}
              onSaveAsCopy={() => void edits.saveAsCopy()}
              onSaveEdit={() => void edits.saveEdit()}
              onToggleFavorite={() => void props.onUpdate(item, { favorite: !item.favorite })}
              onToggleHidden={() => void props.onUpdate(item, { hidden: !item.hidden })}
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
          displayName={stack.displayName}
          mimeType={stack.stackMediaMIME}
          contentUrl={content.contentUrl}
          contentLoading={content.contentLoading}
          contentError={content.contentError}
          mediaStyle={
            stack.stackMediaID === item.id && !(renditionReady && !editing)
              ? libraryEditStyle(appliedEdit)
              : undefined
          }
          assetStack={assetStack}
          stackMediaID={stack.stackMediaID}
          primaryItemID={item.id}
          canEdit={canEdit}
          canCopy={canCopy && Boolean(stack.stackMediaItem)}
          index={index}
          itemCount={items.length}
          imageRef={playback.imageRef}
          videoRef={playback.videoRef}
          onSelectStackMember={stack.setStackMemberID}
          onSetStackEffect={(effect) =>
            assetStack && void props.onSetStackEffect(assetStack, effect)
          }
          onVideoEnded={playback.handleVideoEnded}
          onVideoTime={playback.handleVideoTime}
          onCopyStackMedia={() => void copyItem(stack.stackMediaItem ?? item)}
          onPrevious={goPrevious}
          onNext={goNext}
        />

        {!mobile ? (
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
        ) : null}
        {mobile ? (
          <Sheet open={metadataOpen} onOpenChange={setMetadataOpen}>
            <SheetContent
              side="bottom"
              className="h-[82dvh] rounded-t-2xl border-x-0 border-b-0 bg-charcoal-bg p-0 pb-[env(safe-area-inset-bottom)]"
            >
              <SheetHeader className="border-b border-charcoal-border p-4">
                <SheetTitle>Item details</SheetTitle>
              </SheetHeader>
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
            </SheetContent>
          </Sheet>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
