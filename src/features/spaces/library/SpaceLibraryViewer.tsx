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
} from "@/shared/ui";
import { useState } from "react";
import { copyLibraryItemsToClipboard } from "./libraryClipboard";
import { libraryMediaKind } from "./library-viewer/libraryMediaKind";
import { LibraryPhotoEditorView } from "./library-viewer/LibraryPhotoEditorView";
import { LibraryVideoEditorView } from "./library-viewer/LibraryVideoEditorView";
import { LibraryVideoProjectView } from "./library-viewer/LibraryVideoProjectView";
import { canEditVideo, isVideoProjectFile } from "@/features/files";
import { LibraryViewerSidebar } from "./library-viewer/LibraryViewerSidebar";
import { LibraryViewerStage } from "./library-viewer/LibraryViewerStage";
import { LibraryViewerToolbar } from "./library-viewer/LibraryViewerToolbar";
import { useLibraryEditActions } from "./library-viewer/useLibraryEditActions";
import { useLibraryEditVersions } from "./library-viewer/useLibraryEditVersions";
import {
  useLibraryItemContent,
  usePrefetchLibraryNeighbors,
} from "./library-viewer/useLibraryItemContent";
import { useLibraryViewerKeyboard } from "./library-viewer/useLibraryViewerKeyboard";
import { useLibraryViewerPlayback } from "./library-viewer/useLibraryViewerPlayback";
import { libraryItemMIME } from "./SpaceLibraryPrimitives";
import { libraryEditStyle, normalizeLibraryEdit } from "./SpaceLibraryViewerUtils";
const dialogClass = [
  "grid h-[min(53.75rem,calc(100dvh-2rem))] min-h-0 w-[min(82.5rem,calc(100vw-2rem))] max-w-none",
  "grid-cols-[minmax(0,1fr)_minmax(18.75rem,21.25rem)] grid-rows-[3.5rem_minmax(0,1fr)] gap-0 overflow-hidden",
  "rounded-xl p-0 shadow-lg sm:max-w-none [&>button]:hidden",
].join(" ");
/**
 * Photos, video projects and (where this computer can edit video) videos open in their editors,
 * which take the Media page's content area instead of floating over it.
 */
export function libraryItemOpensInEditor(item: SpaceLibraryItem, canEdit: boolean): boolean {
  const mimeType = libraryItemMIME(item);
  const { isImage, isVideo } = libraryMediaKind(mimeType, item.file.intrinsic_metadata);
  return (
    isImage ||
    isVideoProjectFile(mimeType, item.file.original_filename) ||
    (isVideo && canEdit && canEditVideo())
  );
}
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
  usePrefetchLibraryNeighbors({
    spaceId,
    items,
    index,
    ready: isImage && Boolean(content.contentUrl),
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
      edits.setEditError(error instanceof Error ? error.message : "The file could not be copied.");
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
        onPrevious={index > 0 ? goPrevious : undefined}
        onNext={index >= 0 && index < items.length - 1 ? goNext : undefined}
      />
    );
  // A video project always opens in the video editor, kept in Media for those who can edit it.
  if (isVideoProjectFile(mimeType, item.file.original_filename))
    return (
      <LibraryVideoProjectView
        spaceId={spaceId}
        item={item}
        canEdit={canEdit}
        onClose={onClose}
        onReplaceItem={props.onReplaceItem}
        onSaved={props.onRenditionReady}
      />
    );
  // A video opens in the video editor where it can be saved back; read-only, or where this
  // computer can't edit video, it plays here.
  if (isVideo && canEdit && canEditVideo())
    return (
      <LibraryVideoEditorView
        spaceId={spaceId}
        item={item}
        mimeType={mimeType}
        onClose={onClose}
        onSaved={props.onRenditionReady}
      />
    );
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
            <DialogDescription className="sr-only">
              Preview and edit {item.display_name}.
            </DialogDescription>
            <Text as="p" tone="muted" className="m-0 mt-0.5 text-3xs">
              {index + 1} of {items.length}
            </Text>
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
        </Surface>

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
