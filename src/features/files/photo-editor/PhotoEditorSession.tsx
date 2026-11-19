import type { PreviewErrorComponent } from "../preview/previewTypes";
import { ConfirmDeleteDialog, IconButton, ToolbarDivider, TopBar } from "@/shared/ui";
import { ChevronLeft, ChevronRight, Redo2, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import * as Y from "yjs";
import { AdjustPanel, FiltersPanel } from "./AdjustPanels";
import { CropPanel } from "./CropPanel";
import { removeBackground, useCanRemoveBackground } from "./cutout";
import {
  defaultMarkStyle,
  type MarkStyle,
  type MarkupTool,
  type PhotoEditorProps,
  type TextDraft,
} from "./editorTypes";
import { imageDocParts } from "./imageDoc";
import {
  cropFrame,
  defaultImageEdit,
  mirrorEdit,
  outputSize,
  sameImageEdit,
  topZ,
  type Point,
} from "./imageEdit";
import { CutoutPanel, SizePanel } from "./ImagePanels";
import { uniquePeople, usePeers, usePublishPresence } from "./imagePresence";
import {
  autoAdjustments,
  saveFormatFor,
  workingCopy,
  type PhotoSource,
  type SaveFormat,
} from "./imageRender";
import { ImageStage } from "./ImageStage";
import { MarkupPanel } from "./MarkupPanel";
import {
  EditorFrame,
  EditorTitle,
  PeopleHere,
  SaveControls,
  ViewControls,
} from "./PhotoEditorChrome";
import {
  PhotoEditorLayout,
  PhotoPreviewPane,
  PhotoPropertiesPane,
  PhotoToolsPane,
  markingTabs,
  type PhotoTab,
} from "./PhotoEditorLayout";
import { PhotoProperties } from "./PhotoProperties";
import { SaveAsDialog } from "./SaveAsDialog";
import { stickerMarkAt, useNaturalSize } from "./placing";
import { StickersPanel } from "./StickersPanel";
import { TextPanel } from "./TextPanel";
import { useImageDocument } from "./useImageDocument";
import { useMarkActions } from "./useMarkActions";
import { overEditor, usePhotoKeys } from "./usePhotoKeys";
import { usePhotoSaving } from "./usePhotoSaving";
import { usePhotoTabs } from "./usePhotoTabs";
import { stageContent, useViewport } from "./useViewport";

/**
 * The image in OpenCut's editor layout, without the timeline: the tools down the left (the
 * agent, light and color, filters, crop, markup, text, stickers, size and format, the
 * background), the image in the middle with its view controls under it, and what is picked on
 * the right. Everyone with it open edits one shared edit, live.
 */
export function PhotoEditorSession(
  props: PhotoEditorProps & { Error: PreviewErrorComponent; photo: PhotoSource },
) {
  const { photo, collaboration } = props;
  const readonly = Boolean(props.readonly || collaboration?.readonly);
  // What Save, Save as copy and Download write: the image's own format unless another is chosen.
  const [format, setFormat] = useState<SaveFormat>(() =>
    saveFormatFor(props.outputMimeType || "image/png"),
  );

  // The shared edit, or this window's own when nobody else can join. Nothing else holds a
  // window's own document, so it is simply let go with the editor.
  const shared = Boolean(collaboration);
  const localDoc = useMemo(() => (shared ? null : new Y.Doc()), [shared]);
  const doc = collaboration?.doc ?? localDoc!;
  const parts = useMemo(() => imageDocParts(doc), [doc]);
  const document = useImageDocument(parts, readonly);
  const { edit, change } = document;
  const dirty = !sameImageEdit(edit, defaultImageEdit);

  const awareness = collaboration?.awareness ?? null;
  const me = collaboration?.me ?? null;
  const peers = usePeers(awareness);
  const { publishSelection, publishPointer, publishDraft } = usePublishPresence(awareness, me);

  const natural = useNaturalSize(photo, props.naturalSize);
  // Original pixels per pixel of the image on screen, when it is a smaller preview.
  const pixelRatio = Math.max(natural.width, natural.height) / Math.max(photo.width, photo.height);
  const small = useMemo(() => workingCopy(photo, 1024), [photo]);

  const [tool, setTool] = useState<MarkupTool>("select");
  const [style, setStyle] = useState<MarkStyle>(defaultMarkStyle);
  const [selection, setSelection] = useState<string[]>([]);
  const [compare, setCompare] = useState(false);
  const [textDraft, setTextDraft] = useState<TextDraft | null>(null);
  const [panning, setPanning] = useState(false);
  const [confirming, setConfirming] = useState<null | (() => void)>(null);
  const [savingAs, setSavingAs] = useState(false);

  const tabs = usePhotoTabs({
    edit,
    change,
    natural,
    readonly,
    onLeaveMarkup: () => setSelection([]),
    onShowEdit: () => setCompare(false),
  });
  const { mode, turn } = tabs;
  const canCutOut = useCanRemoveBackground();
  const rail: PhotoTab[] = [
    ...(props.agentPanel ? (["agent"] as const) : []),
    "adjust",
    "filters",
    "crop",
    "markup",
    "text",
    "stickers",
    "size",
    ...(canCutOut ? (["cutout"] as const) : []),
  ];
  const shownTab = rail.includes(tabs.tab) ? tabs.tab : "adjust";
  // The Text tab writes with the text tool and the Stickers tab picks and moves marks; Markup
  // keeps the tool picked in it.
  const activeTool: MarkupTool =
    shownTab === "text" ? "text" : shownTab === "stickers" ? "select" : tool;

  const liveSelection = useMemo(
    () => selection.filter((id) => edit.marks[id]),
    [edit.marks, selection],
  );
  const selectionKey = liveSelection.join(",");
  useEffect(() => {
    publishSelection(selectionKey ? selectionKey.split(",") : []);
  }, [publishSelection, selectionKey]);

  const cropping = mode === "crop" && !compare;
  const viewport = useViewport(stageContent(natural, edit, { cropping, compare }));
  // A new view of the image (cropping it, comparing) starts fitted.
  const fitView = viewport.fit;
  useEffect(() => {
    fitView();
  }, [cropping, compare, fitView]);

  // Leaving: a shared edit stays in the room for everyone, so only an edit of this window's own
  // asks first.
  const close = useCallback(() => (props.onCancel ?? props.onClose)(), [props]);
  const leave = useCallback(
    (go: () => void) => {
      if (dirty && !readonly && !collaboration) setConfirming(() => go);
      else go();
    },
    [collaboration, dirty, readonly],
  );
  const requestClose = useCallback(() => leave(close), [close, leave]);
  const previous = props.onPrevious;
  const next = props.onNext;
  const goPrevious = useCallback(() => previous && leave(previous), [leave, previous]);
  const goNext = useCallback(() => next && leave(next), [leave, next]);

  const pickTool = (picked: MarkupTool) => {
    if (picked === "text") {
      tabs.openTab("text");
      return;
    }
    setTool(picked);
    tabs.openTab("markup");
  };
  /** Writes a new text in the middle of what the image shows. */
  const addText = () => {
    const { center } = cropFrame(edit, natural);
    setTextDraft({ at: { x: center.x, y: center.y - style.text * 0.6 }, text: "" });
  };
  /** Puts a sticker on the image, centered on `at` or the middle, and picks it. */
  const placeSticker = (id: string, at?: Point) => {
    const mark = readonly
      ? null
      : stickerMarkAt(id, { edit, natural, style, author: me?.name, at });
    if (!mark) return;
    change((current) => ({
      ...current,
      marks: { ...current.marks, [mark.id]: { ...mark, z: topZ(current.marks) + 1 } },
    }));
    if (!markingTabs.includes(shownTab)) tabs.openTab("stickers");
    setSelection([mark.id]);
  };
  const saving = usePhotoSaving({
    name: props.name,
    photo,
    edit,
    format,
    readonly,
    parts,
    document,
    loadOriginal: props.loadOriginal,
    onSave: props.onSave,
    onSaveAsCopy: props.onSaveAsCopy,
    onSavedOver: () => setSelection([]),
  });
  const marks = useMarkActions({
    edit,
    change,
    preview: document.preview,
    commit: document.commit,
    picked: liveSelection,
    setPicked: setSelection,
    setStyle,
    setTextDraft,
    author: me?.name,
  });
  const auto = () =>
    change((current) => ({ ...current, adjust: { ...current.adjust, ...autoAdjustments(small) } }));
  const cutOut = () => {
    const stem = props.name.replace(/\.[^./\\]+$/, "") || "image";
    void saving.saveMade(`${stem} (no background).png`, removeBackground);
  };

  /** Escape steps back: out of cropping, the picked marks, the tool in hand, then closes. */
  const stepBack = () => {
    if (confirming || savingAs || window.document.querySelector(overEditor)) return;
    if (mode === "crop") tabs.cancelCrop();
    else if (liveSelection.length) setSelection([]);
    else if (shownTab === "markup" && tool !== "select") setTool("select");
    else requestClose();
  };

  usePhotoKeys(
    {
      readonly,
      mode,
      picked: liveSelection,
      edit,
      natural,
      viewport,
      document,
      saveOver: () => void saving.saveOver(),
      saveCopy: () => void saving.saveCopy(),
      duplicate: marks.duplicate,
      remove: marks.remove,
      nudge: marks.nudge,
      turn,
      pickTool,
      startCrop: () => tabs.openTab("crop"),
      applyCrop: tabs.applyCrop,
      selectAll: () => setSelection(Object.keys(edit.marks)),
      goPrevious,
      goNext,
    },
    Boolean(confirming) || savingAs,
    setPanning,
  );

  const people = uniquePeople(peers);
  const showsNeighbors = mode === "view" && !compare;
  const busy = saving.busy !== null;
  const panel: Record<PhotoTab, () => ReactNode> = {
    agent: () => <div className="flex h-full min-h-0 flex-col">{props.agentPanel}</div>,
    adjust: () => <AdjustPanel edit={edit} document={document} onAuto={auto} />,
    filters: () => <FiltersPanel photo={small} edit={edit} document={document} />,
    crop: () => (
      <CropPanel
        edit={edit}
        document={document}
        aspect={tabs.cropAspect}
        onAspect={tabs.pickAspect}
        changed={tabs.cropChanged}
        onReset={tabs.resetCrop}
        onApply={tabs.applyCrop}
        onTurn={turn}
        onMirror={(axis) => tabs.reshape((current) => mirrorEdit(current, axis))}
      />
    ),
    markup: () => (
      <MarkupPanel
        tool={tool}
        onTool={pickTool}
        style={style}
        onStyle={(partial) => setStyle((current) => ({ ...current, ...partial }))}
      />
    ),
    text: () => (
      <TextPanel
        style={style}
        onStyle={(partial) => setStyle((current) => ({ ...current, ...partial }))}
        onAdd={addText}
      />
    ),
    stickers: () => (
      <StickersPanel
        color={style.color}
        onColor={(color) => setStyle((current) => ({ ...current, color }))}
        onPlace={(id) => placeSticker(id)}
      />
    ),
    size: () => (
      <SizePanel
        edit={edit}
        natural={natural}
        onResize={(resize) => change((current) => ({ ...current, resize }))}
        format={format}
        onFormat={setFormat}
      />
    ),
    cutout: () => <CutoutPanel busy={busy} readonly={readonly} onCutOut={cutOut} />,
  };

  const stage = (
    <>
      <ImageStage
        photo={photo}
        pixelRatio={pixelRatio}
        edit={edit}
        mode={mode}
        cropDraft={tabs.cropDraft}
        onCropDraft={tabs.setCropDraft}
        cropRatio={tabs.cropRatio}
        compare={compare}
        readonly={readonly}
        viewport={viewport}
        document={document}
        tool={activeTool}
        style={style}
        selection={liveSelection}
        onSelection={setSelection}
        author={me?.name}
        peers={peers}
        onPointer={awareness ? publishPointer : undefined}
        onDraft={awareness ? publishDraft : undefined}
        panning={panning}
        textDraft={textDraft}
        onTextDraft={setTextDraft}
        onPlaceSticker={readonly ? undefined : placeSticker}
      />
      {showsNeighbors && props.onPrevious ? (
        <div className="absolute inset-y-0 left-3 my-auto h-fit">
          <IconButton variant="overlay" label="Previous image" shortcut="←" onClick={goPrevious}>
            <ChevronLeft />
          </IconButton>
        </div>
      ) : null}
      {showsNeighbors && props.onNext ? (
        <div className="absolute inset-y-0 right-3 my-auto h-fit">
          <IconButton variant="overlay" label="Next image" shortcut="→" onClick={goNext}>
            <ChevronRight />
          </IconButton>
        </div>
      ) : null}
      {saving.saveError ? (
        <div className="px-6 py-4">
          <props.Error
            error={saving.saveError}
            scope="files:photo-editor:save"
            title="The edited image could not be saved"
          />
        </div>
      ) : null}
    </>
  );
  const viewControls = (
    <ViewControls
      readonly={readonly}
      dirty={dirty}
      compare={compare}
      onCompare={() => setCompare((value) => !value)}
      onTurn={turn}
      viewport={viewport}
    />
  );

  return (
    <EditorFrame name={props.name} onClose={stepBack}>
      <TopBar
        aria-label="Image"
        start={<EditorTitle name={props.name} indexLabel={props.indexLabel} />}
      >
        {people.length ? (
          <>
            <PeopleHere people={people} />
            <ToolbarDivider />
          </>
        ) : null}
        {readonly ? null : (
          <>
            <IconButton
              label="Undo"
              shortcut="⌘Z"
              disabled={!document.canUndo}
              onClick={document.undo}
            >
              <Undo2 />
            </IconButton>
            <IconButton
              label="Redo"
              shortcut="⇧⌘Z"
              disabled={!document.canRedo}
              onClick={document.redo}
            >
              <Redo2 />
            </IconButton>
            <ToolbarDivider />
          </>
        )}
        <SaveControls
          dirty={dirty}
          readonly={readonly}
          busy={busy}
          savesOver={Boolean(props.onSave)}
          onSave={() => void saving.saveOver()}
          onSaveCopy={() => void saving.saveCopy()}
          onSaveAs={() => setSavingAs(true)}
          onDownload={() => void saving.download()}
          onCopyImage={() => void saving.copyImage()}
          onRevert={() => change(() => ({ ...defaultImageEdit }))}
        />
        <IconButton label="Close" shortcut="Esc" onClick={requestClose}>
          <X />
        </IconButton>
      </TopBar>

      <div className="min-h-0 flex-1 pb-3">
        <PhotoEditorLayout
          tools={
            readonly ? undefined : (
              <PhotoToolsPane tabs={rail} active={shownTab} onPick={tabs.openTab}>
                {panel[shownTab]()}
              </PhotoToolsPane>
            )
          }
          preview={<PhotoPreviewPane controls={viewControls}>{stage}</PhotoPreviewPane>}
          properties={
            readonly ? undefined : (
              <PhotoPropertiesPane>
                <PhotoProperties
                  edit={edit}
                  natural={natural}
                  mimeType={format.mimeType}
                  picked={liveSelection.map((id) => edit.marks[id])}
                  tool={activeTool}
                  style={style}
                  readonly={readonly}
                  onStyle={marks.restyle}
                  onFade={marks.fade}
                  onFadeDone={marks.fadeDone}
                  onEditText={marks.editText}
                  onDuplicate={marks.duplicate}
                  onArrange={marks.arrange}
                  onDelete={marks.remove}
                />
              </PhotoPropertiesPane>
            )
          }
        />
      </div>

      <ConfirmDeleteDialog
        open={Boolean(confirming)}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        title="Discard your edits?"
        what="The changes made to this image since it was last saved are lost."
        confirmLabel="Discard"
        onConfirm={() => {
          const go = confirming;
          setConfirming(null);
          go?.();
        }}
      />
      <SaveAsDialog
        open={savingAs}
        onOpenChange={setSavingAs}
        name={props.name}
        mimeType={format.mimeType}
        quality={format.quality}
        size={outputSize(natural, edit)}
        busy={saving.busy === "copy"}
        onSave={(choice) => void saving.saveAs(choice, () => setSavingAs(false))}
      />
    </EditorFrame>
  );
}
