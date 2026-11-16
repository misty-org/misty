import type { PreviewErrorComponent } from "../preview/previewTypes";
import {
  Avatar,
  AvatarFallback,
  Button,
  ConfirmDeleteDialog,
  DropdownMenu,
  Dialog,
  DialogContent,
  DialogTitle,
  DropdownMenuContent,
  IconButton,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Skeleton,
  SplitButton,
  Text,
  ToolbarDivider,
  Tooltip,
  TopBar,
  notify,
  type CropRect,
  ZoomControl,
} from "@/shared/ui";
import {
  ChevronLeft,
  ChevronRight,
  ClipboardCopy,
  Copy,
  Download,
  Eye,
  FilePlus2,
  History,
  Pencil,
  Redo2,
  Share,
  RotateCcw,
  RotateCw,
  Undo2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as Y from "yjs";
import {
  defaultMarkStyle,
  markupToolKeys,
  type EditorMode,
  type MarkStyle,
  type MarkupTool,
  type TextDraft,
} from "./editorTypes";
import { clearImageEdit, imageDocParts } from "./imageDoc";
import {
  defaultImageEdit,
  fullCrop,
  newMarkId,
  outputSize,
  sameCrop,
  sameImageEdit,
  topZ,
  turnEdit,
  type Mark,
} from "./imageEdit";
import {
  uniquePeople,
  usePeers,
  usePublishPresence,
  type ImageCollaboration,
  type ImagePerson,
} from "./imagePresence";
import {
  autoAdjustments,
  canvasToBlob,
  decodedPhoto,
  loadPhoto,
  openPhoto,
  renderFinal,
  workingCopy,
  type PhotoSource,
} from "./imageRender";
import { ImageStage, stageContent } from "./ImageStage";
import { CropBar, MarkupBar } from "./MarkupBar";
import { moveMark } from "./markGeometry";
import { ResizeDialog } from "./ResizeDialog";
import { SaveAsDialog, type SaveAsChoice } from "./SaveAsDialog";
import { useImageDocument } from "./useImageDocument";
import { useViewport } from "./useViewport";

export interface PhotoEditorProps {
  /** Remounts the editor when the underlying image changes. */
  sourceKey: string;
  /** File/display name, shown in the bar and used to name what is saved. */
  name: string;
  /** Object URL (blob:/asset:) for the image to show and edit. */
  url: string;
  /** Where it sits among its neighbors, such as "3 of 12". */
  indexLabel?: string;
  tags?: string[];
  /** Preferred output MIME type; defaults to image/png. */
  outputMimeType?: string;
  loading?: boolean;
  error?: string;
  /** When true, the editor only shows the image. */
  readonly?: boolean;
  /** The original's size in pixels, when `url` is a smaller preview of it. */
  naturalSize?: { width: number; height: number };
  /**
   * The full-size image to save from, when `url` is a smaller preview. Without it, or if it
   * can't be read, the edit is saved from `url`.
   */
  loadOriginal?: () => Promise<Blob>;
  onClose: () => void;
  onCancel?: () => void;
  /** The image before and after this one among its neighbors, when there are any. */
  onPrevious?: () => void;
  onNext?: () => void;
  /**
   * Saves over the original. Left out where that isn't possible: "Save" then saves a copy. It
   * returns the version the original now is, which a shared edit starts again from.
   */
  onSave?: (rendered: Blob) => void | string | Promise<void | string>;
  /** Saves the edited image as a new copy, under `filename` when one is chosen. */
  onSaveAsCopy: (rendered: Blob, filename?: string) => void | Promise<void>;
  /** The edit shared live with others. Without it, the edit belongs to this window alone. */
  collaboration?: ImageCollaboration | null;
}

export function PhotoEditorView(props: PhotoEditorProps & { Error: PreviewErrorComponent }) {
  const [source, setSource] = useState<{ url: string; photo: PhotoSource } | null>(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    if (!props.url) return;
    let live = true;
    setLoadError("");
    openPhoto(props.url)
      .then((photo) => live && setSource({ url: props.url, photo }))
      .catch(() => live && setLoadError("This image couldn’t be opened."));
    return () => {
      live = false;
    };
  }, [props.url]);

  // An image decoded before (stepped back to, or decoded ahead) shows at once.
  const photo =
    source?.url === props.url ? source.photo : props.url ? decodedPhoto(props.url) : undefined;
  if (!photo || props.loading || props.error) {
    return (
      <ViewerFrame name={props.name} onClose={props.onClose}>
        <TopBar
          aria-label="Image"
          start={<EditorTitle name={props.name} indexLabel={props.indexLabel} />}
        >
          <IconButton label="Close" shortcut="Esc" onClick={props.onClose}>
            <X />
          </IconButton>
        </TopBar>
        <div className="grid min-h-0 flex-1 place-items-center p-8">
          {props.error || loadError ? (
            <props.Error
              error={props.error || loadError}
              scope="files:photo-editor"
              title="Image could not be opened"
            />
          ) : (
            <Skeleton
              role="status"
              aria-label="Image"
              aria-hidden={false}
              className="aspect-[4/3] w-full max-w-3xl rounded-lg"
            />
          )}
        </div>
      </ViewerFrame>
    );
  }
  return <PhotoEditorSession key={props.sourceKey} {...props} photo={photo} />;
}

/** What, open over the editor, takes the keys instead: a menu, a list, a popover or a dialog. */
const overEditor = [
  "[data-radix-popper-content-wrapper] [role='menu']",
  "[data-radix-popper-content-wrapper] [role='listbox']",
  "[data-radix-popper-content-wrapper] [data-slot='popover-content']",
  "[role='alertdialog']",
  "[role='dialog'][data-state='open']:not([data-image-viewer])",
].join(", ");

/** Controls that Space presses, so holding it doesn't move the image instead. */
const spaceControls =
  "button, [role='button'], [role='radio'], [role='switch'], [role='slider'], [role='checkbox'], [role='tab']";

/** Whether a key press belongs to something being typed in, not to the editor. */
function typing(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  return Boolean(element?.closest("input, textarea, select, [contenteditable='true']"));
}

/**
 * The image, as macOS Preview shows one: fitted in the window under one thin bar of view
 * controls (zoom, turn, the previous and next image). The pencil adds a second row for marking
 * it up, cropping, color and size. Everyone with it open edits one shared edit, live.
 */
function PhotoEditorSession(
  props: PhotoEditorProps & { Error: PreviewErrorComponent; photo: PhotoSource },
) {
  const { photo, collaboration } = props;
  const readonly = Boolean(props.readonly || collaboration?.readonly);
  const mimeType = props.outputMimeType || "image/png";

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

  // The original's size, when the image shown is a smaller copy of it with the same shape.
  const givenWidth = props.naturalSize?.width ?? 0;
  const givenHeight = props.naturalSize?.height ?? 0;
  const natural = useMemo(() => {
    const shape = photo.width / photo.height;
    const sameShape =
      givenWidth > 0 &&
      givenHeight > 0 &&
      Math.abs(givenWidth / givenHeight - shape) < 0.02 * shape;
    return sameShape
      ? { width: givenWidth, height: givenHeight }
      : { width: photo.width, height: photo.height };
  }, [givenHeight, givenWidth, photo]);
  // Original pixels per pixel of the image on screen, when it is a smaller preview.
  const pixelRatio = Math.max(natural.width, natural.height) / Math.max(photo.width, photo.height);
  const small = useMemo(() => workingCopy(photo, 1024), [photo]);

  const [mode, setMode] = useState<EditorMode>("view");
  const [tool, setTool] = useState<MarkupTool>("select");
  const [style, setStyle] = useState<MarkStyle>(defaultMarkStyle);
  const [selection, setSelection] = useState<string[]>([]);
  const [cropDraft, setCropDraft] = useState<CropRect | null>(null);
  const [compare, setCompare] = useState(false);
  const [textDraft, setTextDraft] = useState<TextDraft | null>(null);
  const [panning, setPanning] = useState(false);
  const [busy, setBusy] = useState<null | "save" | "copy" | "export">(null);
  const [saveError, setSaveError] = useState("");
  const [confirming, setConfirming] = useState<null | (() => void)>(null);
  const [savingAs, setSavingAs] = useState(false);
  const [resizing, setResizing] = useState(false);

  const liveSelection = useMemo(
    () => selection.filter((id) => edit.marks[id]),
    [edit.marks, selection],
  );
  const selectedMarks = liveSelection.map((id) => edit.marks[id]);
  const selectionKey = liveSelection.join(",");
  useEffect(() => {
    publishSelection(selectionKey ? selectionKey.split(",") : []);
  }, [publishSelection, selectionKey]);

  const cropping = mode === "crop" && Boolean(cropDraft) && !readonly && !compare;
  const content = stageContent(natural, edit, { cropping, compare });
  const viewport = useViewport(content);
  // A new view of the image (cropping it, comparing) starts fitted.
  const fitView = viewport.fit;
  useEffect(() => {
    fitView();
  }, [cropping, compare, fitView]);

  // ------------------------------------------------------------------------------------------
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

  // ------------------------------------------------------------------------------------------
  // Modes

  const toggleMarkup = () => {
    setCompare(false);
    setCropDraft(null);
    setSelection([]);
    setMode((current) => (current === "view" ? "markup" : "view"));
  };
  const startCrop = () => {
    setCompare(false);
    setSelection([]);
    setCropDraft(edit.crop);
    setMode("crop");
  };
  const cancelCrop = () => {
    setCropDraft(null);
    setMode("markup");
  };
  const applyCrop = () => {
    const crop = cropDraft;
    setCropDraft(null);
    setMode("markup");
    if (crop && !sameCrop(crop, edit.crop))
      change((current) => ({ ...current, crop, aspect: "free" }));
  };

  // ------------------------------------------------------------------------------------------
  // Saving

  /** The whole edit at full size, from the original when there is one. */
  const renderEdited = useCallback(async () => {
    const full = props.loadOriginal
      ? await props
          .loadOriginal()
          .then(loadPhoto)
          .catch(() => photo)
      : photo;
    return renderFinal(full, edit);
  }, [edit, photo, props]);

  const run = useCallback(
    async (kind: "save" | "copy" | "export", work: () => Promise<void>) => {
      if (busy) return;
      setBusy(kind);
      setSaveError("");
      try {
        await work();
      } catch (reason) {
        setSaveError(reason instanceof Error ? reason.message : "The image could not be saved.");
      } finally {
        setBusy(null);
      }
    },
    [busy],
  );

  const saveOver = useCallback(
    () =>
      run("save", async () => {
        if (readonly) return;
        const blob = await canvasToBlob(await renderEdited(), mimeType);
        if (!props.onSave) {
          await props.onSaveAsCopy(blob);
          notify({ message: "Saved a copy to the Library" });
          return;
        }
        const base = await props.onSave(blob);
        // The edit is in the image now: everyone starts again from the saved image.
        clearImageEdit(parts, typeof base === "string" ? base : "", { image: "saved" });
        document.forget();
        setSelection([]);
      }),
    [document, mimeType, parts, props, readonly, renderEdited, run],
  );
  const saveCopy = useCallback(
    () =>
      run("copy", async () => {
        if (readonly) return;
        const blob = await canvasToBlob(await renderEdited(), mimeType);
        await props.onSaveAsCopy(blob);
        notify({ message: "Saved a copy to the Library" });
      }),
    [mimeType, props, readonly, renderEdited, run],
  );
  const saveAs = (choice: SaveAsChoice) =>
    run("copy", async () => {
      const blob = await canvasToBlob(await renderEdited(), choice.mimeType, choice.quality);
      await props.onSaveAsCopy(blob, choice.filename);
      setSavingAs(false);
      notify({ message: `Saved “${choice.filename}” to the Library` });
    });
  const download = () =>
    run("export", async () => {
      const blob = await canvasToBlob(await renderEdited(), mimeType);
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = filenameFor(props.name, mimeType);
      window.document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  const copyImage = () =>
    run("export", async () => {
      const blob = await canvasToBlob(await renderEdited(), "image/png");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      notify({ message: "Copied the image" });
    });

  // ------------------------------------------------------------------------------------------
  // Marks

  const restyle = (partial: Partial<MarkStyle>) => {
    setStyle((current) => ({ ...current, ...partial }));
    if (!liveSelection.length) return;
    change((current) => {
      const marks = { ...current.marks };
      for (const id of liveSelection) {
        const mark = marks[id];
        if (!mark) continue;
        let next: Mark = mark;
        if (partial.color && next.kind !== "redact") next = { ...next, color: partial.color };
        if (partial.stroke && next.kind !== "text" && next.kind !== "redact")
          next = { ...next, size: partial.stroke };
        if (partial.text && next.kind === "text") next = { ...next, size: partial.text };
        if (partial.fill !== undefined && (next.kind === "rect" || next.kind === "ellipse"))
          next = { ...next, fill: partial.fill };
        marks[id] = next;
      }
      return { ...current, marks };
    });
  };
  const duplicateSelection = () => {
    if (!liveSelection.length) return;
    const ids: string[] = [];
    change((current) => {
      const marks = { ...current.marks };
      let z = topZ(current.marks);
      for (const id of liveSelection) {
        const mark = current.marks[id];
        if (!mark) continue;
        const copy: Mark = { ...moveMark(mark, 0.02, 0.02), id: newMarkId(), z: ++z };
        if (me) copy.author = me.name;
        marks[copy.id] = copy;
        ids.push(copy.id);
      }
      return { ...current, marks };
    });
    setSelection(ids);
  };
  const deleteSelection = () => {
    if (!liveSelection.length) return;
    change((current) => {
      const marks = { ...current.marks };
      for (const id of liveSelection) delete marks[id];
      return { ...current, marks };
    });
    setSelection([]);
  };
  const arrange = (to: "front" | "back") =>
    change((current) => {
      const all = Object.values(current.marks);
      const marks = { ...current.marks };
      const picked = liveSelection
        .map((id) => marks[id])
        .filter(Boolean)
        .sort((a, b) => a.z - b.z);
      if (to === "front") {
        let z = Math.max(0, ...all.map((mark) => mark.z));
        for (const mark of picked) marks[mark.id] = { ...mark, z: ++z };
      } else {
        let z = Math.min(0, ...all.map((mark) => mark.z)) - picked.length;
        for (const mark of picked) marks[mark.id] = { ...mark, z: z++ };
      }
      return { ...current, marks };
    });
  const editText = () => {
    const mark = liveSelection.length === 1 ? edit.marks[liveSelection[0]] : null;
    if (mark?.kind === "text") setTextDraft({ at: mark.at, markId: mark.id, text: mark.text });
  };
  const nudge = (dx: number, dy: number) =>
    change((current) => {
      const marks = { ...current.marks };
      for (const id of liveSelection) if (marks[id]) marks[id] = moveMark(marks[id], dx, dy);
      return { ...current, marks };
    });
  const pickTool = (next: MarkupTool) => {
    setCompare(false);
    setCropDraft(null);
    setTool(next);
    setMode("markup");
  };
  const auto = () =>
    change((current) => ({
      ...current,
      adjust: { ...current.adjust, ...autoAdjustments(small) },
    }));

  /** Escape steps back: out of cropping, the picked marks, the tool, the markup row, then closes. */
  const stepBack = () => {
    if (mode === "crop") cancelCrop();
    else if (liveSelection.length) setSelection([]);
    else if (mode === "markup" && tool !== "select") setTool("select");
    else if (mode === "markup") setMode("view");
    else requestClose();
  };

  // ------------------------------------------------------------------------------------------
  // Keys (Escape is the dialog's, through stepBack): ⌘Z and ⇧⌘Z undo and redo, ⌘S saves, the zoom keys,
  // ← and → for the neighboring images, the markup tools' letters, Enter to crop, and Space held
  // to move the image.

  const keys = useRef({
    requestClose,
    saveOver,
    saveCopy,
    document,
    viewport,
    deleteSelection,
    duplicateSelection,
    nudge,
    pickTool,
    startCrop,
    applyCrop,
    cancelCrop,
    goPrevious,
    goNext,
    liveSelection,
    mode,
    tool,
    edit,
    natural,
  });
  keys.current = {
    requestClose,
    saveOver,
    saveCopy,
    document,
    viewport,
    deleteSelection,
    duplicateSelection,
    nudge,
    pickTool,
    startCrop,
    applyCrop,
    cancelCrop,
    goPrevious,
    goNext,
    liveSelection,
    mode,
    tool,
    edit,
    natural,
  };
  const blocked = Boolean(confirming) || savingAs || resizing;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (blocked || event.defaultPrevented || typing(event.target)) return;
      if (window.document.querySelector(overEditor)) return;
      const k = keys.current;
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (event.key === " ") {
        // Space still presses the button or control in focus.
        if ((event.target as HTMLElement | null)?.closest(spaceControls)) return;
        event.preventDefault();
        if (!event.repeat) setPanning(true);
        return;
      }
      if (event.key === "Enter" && k.mode === "crop") {
        event.preventDefault();
        k.applyCrop();
        return;
      }
      if (mod && (key === "=" || key === "+")) {
        event.preventDefault();
        k.viewport.zoomIn();
        return;
      }
      if (mod && key === "-") {
        event.preventDefault();
        k.viewport.zoomOut();
        return;
      }
      if (mod && key === "0") {
        event.preventDefault();
        k.viewport.fit();
        return;
      }
      if (mod && key === "1") {
        event.preventDefault();
        k.viewport.zoomTo(1);
        return;
      }
      const arrows: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      // Arrows move picked marks; otherwise ← and → go to the neighboring images.
      if (arrows[event.key] && !mod && !k.liveSelection.length && k.mode !== "crop") {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          if (event.key === "ArrowLeft") k.goPrevious();
          else k.goNext();
        }
        return;
      }
      if (readonly) return;
      if (mod && key === "z") {
        event.preventDefault();
        if (event.shiftKey) k.document.redo();
        else k.document.undo();
        return;
      }
      if (mod && key === "y") {
        event.preventDefault();
        k.document.redo();
        return;
      }
      if (mod && key === "s") {
        event.preventDefault();
        void (event.shiftKey ? k.saveCopy() : k.saveOver());
        return;
      }
      if (mod && key === "r") {
        // ⌘R would reload the window; here it turns the image.
        event.preventDefault();
        k.document.change((current) => turnEdit(current, !event.shiftKey));
        return;
      }
      if (mod && key === "d") {
        event.preventDefault();
        k.duplicateSelection();
        return;
      }
      if (mod && key === "a" && k.mode === "markup") {
        event.preventDefault();
        setSelection(Object.keys(k.edit.marks));
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && k.liveSelection.length) {
        event.preventDefault();
        k.deleteSelection();
        return;
      }
      if (arrows[event.key] && k.liveSelection.length && !mod) {
        event.preventDefault();
        // One screen pixel, or ten with Shift, in the image's own space.
        const step =
          (event.shiftKey ? 10 : 1) /
          Math.max(1e-9, k.viewport.scale * Math.max(k.natural.width, k.natural.height));
        k.nudge(arrows[event.key][0] * step, arrows[event.key][1] * step);
        return;
      }
      if (mod || event.altKey) return;
      if (key === "c" && k.mode !== "crop") {
        event.preventDefault();
        k.startCrop();
        return;
      }
      const tool = (Object.keys(markupToolKeys) as MarkupTool[]).find(
        (id) => markupToolKeys[id].toLowerCase() === key,
      );
      if (tool && k.mode !== "crop") {
        event.preventDefault();
        k.pickTool(tool);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === " ") setPanning(false);
    };
    const onBlur = () => setPanning(false);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [blocked, readonly]);

  const people = uniquePeople(peers);
  const zoomLabel = viewport.fitted ? "Fit" : `${Math.round(viewport.scale * 100)}%`;
  const showsNeighbors = mode === "view" && !compare;
  const saveMenu = (
    <DropdownMenuContent align="end" width="md">
      {readonly ? null : (
        <>
          {props.onSave && dirty ? (
            <MenuItem
              icon={Copy}
              label="Save as copy"
              shortcut="⇧⌘S"
              onSelect={() => void saveCopy()}
            />
          ) : null}
          <MenuItem icon={FilePlus2} label="Save as…" onSelect={() => setSavingAs(true)} />
        </>
      )}
      <MenuItem icon={Download} label="Download" onSelect={() => void download()} />
      <MenuItem icon={ClipboardCopy} label="Copy image" onSelect={() => void copyImage()} />
      {readonly || !dirty ? null : (
        <>
          <MenuSeparator />
          <MenuItem
            icon={History}
            label="Revert to original"
            onSelect={() => change(() => ({ ...defaultImageEdit }))}
          />
        </>
      )}
    </DropdownMenuContent>
  );

  return (
    <ViewerFrame name={props.name} onClose={requestClose} onEscape={stepBack}>
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
        {readonly || mode === "view" ? null : (
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
        <ZoomControl
          value={zoomLabel}
          canZoomIn={viewport.canZoomIn}
          canZoomOut={viewport.canZoomOut}
          onZoomIn={viewport.zoomIn}
          onZoomOut={viewport.zoomOut}
          shortcuts={{ zoomIn: "⌘+", zoomOut: "⌘−" }}
        >
          <MenuItem label="Zoom to fit" shortcut="⌘0" onSelect={viewport.fit} />
          <MenuSeparator />
          <MenuItem label="50%" onSelect={() => viewport.zoomTo(0.5)} />
          <MenuItem label="100%" shortcut="⌘1" onSelect={() => viewport.zoomTo(1)} />
          <MenuItem label="200%" onSelect={() => viewport.zoomTo(2)} />
          <MenuItem label="400%" onSelect={() => viewport.zoomTo(4)} />
        </ZoomControl>
        {readonly ? null : (
          <>
            <ToolbarDivider />
            <IconButton
              label="Rotate left"
              shortcut="⇧⌘R"
              onClick={() => change((current) => turnEdit(current, false))}
            >
              <RotateCcw />
            </IconButton>
            <IconButton
              label="Rotate right"
              shortcut="⌘R"
              onClick={() => change((current) => turnEdit(current, true))}
            >
              <RotateCw />
            </IconButton>
            <IconButton
              label={mode === "view" ? "Show markup tools" : "Hide markup tools"}
              aria-pressed={mode !== "view"}
              onClick={toggleMarkup}
            >
              <Pencil />
            </IconButton>
          </>
        )}
        {dirty ? (
          <IconButton
            label={compare ? "Show the edit" : "Show the original"}
            aria-pressed={compare}
            onClick={() => setCompare((value) => !value)}
          >
            <Eye />
          </IconButton>
        ) : null}
        <ToolbarDivider />
        {dirty && !readonly ? (
          <SplitButton label="Save">
            <Button
              variant="primary"
              disabled={busy !== null}
              loading={busy === "save"}
              onClick={() => void saveOver()}
            >
              {props.onSave ? "Save" : "Save as copy"}
            </Button>
            <DropdownMenu>
              <MenuTrigger
                iconOnly
                chevron
                label="More ways to save"
                variant="primary"
                disabled={busy !== null}
              />
              {saveMenu}
            </DropdownMenu>
          </SplitButton>
        ) : (
          <DropdownMenu>
            <MenuTrigger
              iconOnly
              icon={Share}
              label={readonly ? "Download or copy" : "Save a copy, download or copy"}
              disabled={busy !== null}
            />
            {saveMenu}
          </DropdownMenu>
        )}
        <IconButton label="Close" shortcut="Esc" onClick={requestClose}>
          <X />
        </IconButton>
      </TopBar>

      {mode === "crop" && !readonly ? (
        <CropBar
          changed={Boolean(cropDraft && !sameCrop(cropDraft, fullCrop))}
          onReset={() => setCropDraft(fullCrop)}
          onCancel={cancelCrop}
          onApply={applyCrop}
        />
      ) : mode === "markup" && !readonly ? (
        <MarkupBar
          edit={edit}
          document={document}
          tool={tool}
          onTool={pickTool}
          style={style}
          onStyle={restyle}
          selection={selectedMarks}
          onDuplicate={duplicateSelection}
          onDelete={deleteSelection}
          onArrange={arrange}
          onEditText={editText}
          onCrop={startCrop}
          onResize={() => setResizing(true)}
          onAuto={auto}
        />
      ) : null}

      <div className="relative flex min-h-0 flex-1 flex-col">
        <ImageStage
          photo={photo}
          pixelRatio={pixelRatio}
          edit={edit}
          mode={mode}
          cropDraft={cropDraft}
          onCropDraft={setCropDraft}
          compare={compare}
          readonly={readonly}
          viewport={viewport}
          document={document}
          tool={tool}
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
        />
        {showsNeighbors && props.onPrevious ? (
          <div className="absolute top-1/2 left-3 -translate-y-1/2">
            <IconButton variant="overlay" label="Previous image" shortcut="←" onClick={goPrevious}>
              <ChevronLeft />
            </IconButton>
          </div>
        ) : null}
        {showsNeighbors && props.onNext ? (
          <div className="absolute top-1/2 right-3 -translate-y-1/2">
            <IconButton variant="overlay" label="Next image" shortcut="→" onClick={goNext}>
              <ChevronRight />
            </IconButton>
          </div>
        ) : null}
        {saveError ? (
          <div className="px-6 py-4">
            <props.Error
              error={saveError}
              scope="files:photo-editor:save"
              title="The edited image could not be saved"
            />
          </div>
        ) : null}
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
        mimeType={mimeType}
        size={outputSize(natural, edit)}
        busy={busy === "copy"}
        onSave={(choice) => void saveAs(choice)}
      />
      <ResizeDialog
        open={resizing}
        onOpenChange={setResizing}
        edit={edit}
        natural={natural}
        onResize={(resize) => change((current) => ({ ...current, resize }))}
      />
    </ViewerFrame>
  );
}

/** The file name a download gets: the image's name with the saved format's extension. */
function filenameFor(name: string, mimeType: string) {
  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType === "image/webp" ? "webp" : "png";
  const stem = name.replace(/\.[^./\\]+$/, "") || "image";
  return `${stem}.${extension}`;
}

/** Who else is in the image, by face: people in their tone, agents named as agents. */
function PeopleHere({ people }: { people: ImagePerson[] }) {
  const shown = people.slice(0, 4);
  const more = people.length - shown.length;
  return (
    <div role="group" aria-label="In this image now" className="flex items-center gap-1">
      {shown.map((person) => (
        <Tooltip key={person.id} content={person.agent ? `${person.name} (agent)` : person.name}>
          <Avatar size="sm" tone={person.tone} aria-label={person.name}>
            <AvatarFallback>{initials(person.name)}</AvatarFallback>
          </Avatar>
        </Tooltip>
      ))}
      {more > 0 ? (
        <Tooltip
          content={people
            .slice(4)
            .map((person) => person.name)
            .join(", ")}
        >
          <Text size="meta" tone="muted" className="px-1 tabular-nums">
            {`+${more}`}
          </Text>
        </Tooltip>
      ) : null}
    </div>
  );
}

function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  return (
    words.length === 1 ? words[0].slice(0, 2) : `${words[0][0]}${words[words.length - 1][0]}`
  ).toUpperCase();
}

function EditorTitle(props: { name: string; indexLabel?: string }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <Text size="control" tone="bright" weight="medium" full className="min-w-0">
        {props.name}
      </Text>
      {props.indexLabel ? (
        <Text size="meta" tone="muted" className="shrink-0">
          {props.indexLabel}
        </Text>
      ) : null}
    </div>
  );
}

/**
 * The viewer's frame: the shared media dialog, a large card over the window less a margin, as the
 * design system shows images and previews. Escape is handed to `onEscape` so it can step back
 * through what is open before it closes the viewer.
 */
function ViewerFrame(props: {
  name: string;
  onClose: () => void;
  onEscape?: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogContent
        size="media"
        hideClose
        aria-describedby={undefined}
        data-image-viewer=""
        className="gap-0 p-0"
        onEscapeKeyDown={(event) => {
          if (!props.onEscape) return;
          event.preventDefault();
          props.onEscape();
        }}
      >
        <DialogTitle className="sr-only">{props.name}</DialogTitle>
        {props.children}
      </DialogContent>
    </Dialog>
  );
}
