import {
  ImageCropFrame,
  LivePointer,
  ShapeSelection,
  Surface,
  cn,
  type CropRect,
} from "@misty/ui";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  stickerDragType,
  type EditorMode,
  type MarkStyle,
  type MarkupTool,
  type TextDraft,
} from "./editorTypes";
import {
  defaultImageEdit,
  sourceToDrawing,
  topZ,
  newMarkId,
  type ImageEdit,
  type Mark,
  type Point,
} from "./imageEdit";
import type { ImagePeer } from "./imagePresence";
import { renderPhoto, workingCopy, type Drawn, type PhotoSource } from "./imageRender";
import { drawMarks } from "./markRender";
import { markBounds, unionBounds } from "./markGeometry";
import { MarkupLayer } from "./MarkupLayer";
import { TextBox } from "./TextBox";
import { useStickersLoaded } from "./stickers";
import type { ImageDocument } from "./useImageDocument";
import type { Viewport } from "./useViewport";

/** The longest side the preview draws at once settled, and while a slider moves. */
const previewSide = 2560;
const quickSide = 1024;
/** How soon after the last change a preview counts as settled, in milliseconds. */
const settleMs = 260;

/**
 * The image being edited, as large as the viewport makes it: the photo with its edit, its marks
 * over it, and whatever the tool in hand needs on top (the crop frame, the markup layer). Others
 * in the editor show here too: their pointers, what they picked and what they are drawing.
 */
export function ImageStage(props: {
  photo: PhotoSource;
  /** Original pixels per pixel of `photo`, when it is a smaller preview of the original. */
  pixelRatio: number;
  edit: ImageEdit;
  mode: EditorMode;
  /** The crop being dragged out while cropping, applied only when the person says so. */
  cropDraft: CropRect | null;
  onCropDraft: (crop: CropRect) => void;
  /** The width over height, in pixels, the crop frame keeps to; null for any shape. */
  cropRatio?: number | null;
  compare: boolean;
  readonly: boolean;
  viewport: Viewport;
  document: ImageDocument;
  tool: MarkupTool;
  style: MarkStyle;
  selection: string[];
  onSelection: (ids: string[]) => void;
  author?: string;
  peers: ImagePeer[];
  onPointer?: (point: Point | null) => void;
  onDraft?: (mark: Mark | null) => void;
  /** Space is held: dragging moves the stage whatever the tool. */
  panning: boolean;
  textDraft: TextDraft | null;
  onTextDraft: (draft: TextDraft | null) => void;
  /** A sticker dragged from the Stickers tab was let go over the image, at `at`. */
  onPlaceSticker?: (id: string, at: Point) => void;
}) {
  const { photo, edit, viewport, compare, readonly } = props;
  const cropping = props.mode === "crop" && Boolean(props.cropDraft) && !readonly && !compare;
  const marking = props.mode === "markup" && !readonly && !compare;
  const shown = compare ? defaultImageEdit : edit;

  const full = useMemo(() => workingCopy(photo, previewSide), [photo]);
  const quick = useMemo(() => workingCopy(photo, quickSide), [photo]);

  // Where the image's own space lands in the image's box on screen, and back.
  const side = Math.max(photo.width, photo.height);
  // The viewport counts the original's pixels; the photo here may be a smaller copy of it.
  const scale = viewport.scale * props.pixelRatio;
  const matrix = useMemo(
    () => sourceToDrawing(shown, photo, { scale, crop: !cropping }),
    [cropping, photo, scale, shown],
  );
  const inverse = useMemo(() => matrix.inverse(), [matrix]);
  const toBox = useMemo(
    () => (point: Point) => {
      const at = matrix.transformPoint(new DOMPoint(point.x * side, point.y * side));
      return { x: at.x, y: at.y };
    },
    [matrix, side],
  );
  const toUnits = useMemo(
    () => (x: number, y: number) => {
      const at = inverse.transformPoint(new DOMPoint(x, y));
      return { x: at.x / side, y: at.y / side };
    },
    [inverse, side],
  );
  const unitsPerPixel = 1 / Math.max(1e-9, scale * side);

  // ------------------------------------------------------------------------------------------
  // Drawing the photo: quickly at a smaller size while it is changing, then sharp once it settles.

  const photoCanvas = useRef<HTMLCanvasElement>(null);
  const marksCanvas = useRef<HTMLCanvasElement>(null);
  const drawnRef = useRef<Drawn | null>(null);
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const [drawnVersion, setDrawnVersion] = useState(0);
  const photoKey = JSON.stringify({ ...shown, marks: null, resize: null, cropping });
  const lastChange = useRef(0);
  useEffect(() => {
    const canvas = photoCanvas.current;
    if (!canvas) return;
    const now = performance.now();
    const changing = now - lastChange.current < settleMs;
    lastChange.current = now;
    const draw = (source: PhotoSource) => {
      try {
        const { drawn } = renderPhoto(source, shownRef.current, { canvas, crop: !cropping });
        drawnRef.current = drawn;
        setDrawnVersion((version) => version + 1);
      } catch (error) {
        console.error(error);
      }
    };
    let frame = requestAnimationFrame(() => draw(changing ? quick : full));
    const settle = changing
      ? window.setTimeout(() => {
          frame = requestAnimationFrame(() => draw(full));
        }, settleMs)
      : 0;
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(settle);
    };
  }, [photoKey, cropping, full, quick]);

  // ------------------------------------------------------------------------------------------
  // Drawing the marks over it, with what is being drawn right now by anyone. Stickers still
  // loading are drawn once they arrive.

  const [ownDraft, setOwnDraft] = useState<Mark | null>(null);
  const onDraft = props.onDraft;
  const setDraft = (mark: Mark | null) => {
    setOwnDraft(mark);
    onDraft?.(mark);
  };
  const drafts = useMemo(() => {
    const list: Mark[] = [];
    for (const peer of props.peers) if (peer.draft) list.push(peer.draft);
    if (ownDraft) list.push(ownDraft);
    return list;
  }, [ownDraft, props.peers]);
  const stickersArrived = useStickersLoaded(edit.marks);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const canvas = marksCanvas.current;
      const base = photoCanvas.current;
      const drawn = drawnRef.current;
      if (!canvas || !base || !drawn) return;
      if (canvas.width !== base.width) canvas.width = base.width;
      if (canvas.height !== base.height) canvas.height = base.height;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      if (compare) return;
      try {
        drawMarks(context, shownRef.current, drawn, { photo: base, extra: drafts });
      } catch (error) {
        console.error(error);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [compare, drafts, drawnVersion, edit.marks, stickersArrived]);

  // ------------------------------------------------------------------------------------------
  // Zooming with the wheel or a pinch, and moving the stage by dragging it.

  const stageRef = useRef<HTMLElement | null>(null);
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const setStage = viewport.setStage;
  useEffect(() => {
    const stage = stageRef.current;
    setStage(stage);
    if (!stage) return;
    const local = (event: { clientX: number; clientY: number }) => {
      const box = stage.getBoundingClientRect();
      return { x: event.clientX - box.left, y: event.clientY - box.top };
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const view = viewportRef.current;
      // A pinch on a trackpad, or the wheel with ⌘ or Ctrl, zooms; otherwise the wheel moves.
      if (event.ctrlKey || event.metaKey) {
        const lines = event.deltaMode === 1 ? 16 : 1;
        view.zoomBy(Math.exp((-event.deltaY * lines) / 240), local(event));
      } else {
        view.panBy(-event.deltaX, -event.deltaY);
      }
    };
    // Safari reports a trackpad pinch as gesture events instead.
    let gestureScale = 1;
    const onGestureStart = (event: Event) => {
      event.preventDefault();
      gestureScale = 1;
    };
    const onGestureChange = (event: Event) => {
      event.preventDefault();
      const gesture = event as Event & { scale: number; clientX: number; clientY: number };
      const factor = gesture.scale / gestureScale;
      gestureScale = gesture.scale;
      viewportRef.current.zoomBy(factor, local(gesture));
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    stage.addEventListener("gesturestart", onGestureStart);
    stage.addEventListener("gesturechange", onGestureChange);
    return () => {
      stage.removeEventListener("wheel", onWheel);
      stage.removeEventListener("gesturestart", onGestureStart);
      stage.removeEventListener("gesturechange", onGestureChange);
      setStage(null);
    };
  }, [setStage]);

  const boxRef = useRef<HTMLDivElement>(null);
  const panGesture = useRef<{ x: number; y: number; id: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  // Dragging the image moves it whenever no tool is drawing on it: with Space held, the middle
  // button, or in the light, color and filter panels.
  const dragMoves = props.panning || (!marking && !cropping);
  const onStagePointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    const middle = event.button === 1;
    if (!middle && !(event.button === 0 && (dragMoves || cropping))) return;
    if (!viewport.pannable && !middle) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    panGesture.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
    setDragging(true);
  };
  const onStagePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const pan = panGesture.current;
    if (pan && pan.id === event.pointerId) {
      viewport.panBy(event.clientX - pan.x, event.clientY - pan.y);
      pan.x = event.clientX;
      pan.y = event.clientY;
    }
    if (!props.onPointer || compare) return;
    const box = boxRef.current?.getBoundingClientRect();
    if (!box) return;
    const x = event.clientX - box.left;
    const y = event.clientY - box.top;
    const inside = x >= 0 && y >= 0 && x <= box.width && y <= box.height;
    props.onPointer(inside ? toUnits(x, y) : null);
  };
  // A sticker dragged in from the Stickers tab lands where it is let go.
  const placeSticker = props.onPlaceSticker;
  const takesStickers = Boolean(placeSticker) && !readonly && !compare && !cropping;
  const onDragOver = (event: ReactDragEvent<HTMLElement>) => {
    if (!takesStickers || !event.dataTransfer.types.includes(stickerDragType)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };
  const onDrop = (event: ReactDragEvent<HTMLElement>) => {
    const id = event.dataTransfer.getData(stickerDragType);
    const box = boxRef.current?.getBoundingClientRect();
    if (!takesStickers || !id || !box) return;
    event.preventDefault();
    placeSticker?.(id, toUnits(event.clientX - box.left, event.clientY - box.top));
  };
  const endPan = (event: ReactPointerEvent<HTMLElement>) => {
    if (panGesture.current?.id !== event.pointerId) return;
    panGesture.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };

  // Others' picks, in their tone.
  const peerSelections =
    compare || cropping
      ? []
      : props.peers.flatMap((peer) => {
          const bounds = unionBounds(
            (peer.selection ?? [])
              .map((id) => edit.marks[id])
              .filter((mark): mark is Mark => Boolean(mark))
              .map(markBounds),
          );
          if (!bounds) return [];
          const outline = [
            toBox(bounds),
            toBox({ x: bounds.x + bounds.width, y: bounds.y }),
            toBox({ x: bounds.x + bounds.width, y: bounds.y + bounds.height }),
            toBox({ x: bounds.x, y: bounds.y + bounds.height }),
          ];
          return [{ key: peer.clientId, tone: peer.user.tone, outline }];
        });

  return (
    <Surface
      tone="page"
      ref={stageRef}
      data-image-stage=""
      className={cn(
        "relative min-h-0 min-w-0 flex-1 touch-none overflow-hidden select-none",
        dragging ? "cursor-grabbing" : dragMoves && viewport.pannable ? "cursor-grab" : undefined,
      )}
      onPointerDown={onStagePointerDown}
      onPointerMove={onStagePointerMove}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      onPointerLeave={() => props.onPointer?.(null)}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div
        ref={boxRef}
        className="absolute"
        style={{
          left: viewport.left,
          top: viewport.top,
          width: viewport.width,
          height: viewport.height,
        }}
      >
        <canvas
          ref={photoCanvas}
          aria-hidden="true"
          className={cn(
            "absolute inset-0 block size-full",
            // Zoomed past the preview's own pixels, they show as pixels rather than a blur.
            scale > 2 && "[image-rendering:pixelated]",
          )}
        />
        <canvas
          ref={marksCanvas}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 block size-full"
        />
        {cropping && props.cropDraft ? (
          <ImageCropFrame
            rect={props.cropDraft}
            ratio={props.cropRatio ?? null}
            label="Crop area"
            onChange={props.onCropDraft}
          />
        ) : null}
        {peerSelections.map((selection) => (
          <ShapeSelection key={selection.key} outline={selection.outline} tone={selection.tone} />
        ))}
        {marking ? (
          <MarkupLayer
            edit={edit}
            toBox={toBox}
            toUnits={toUnits}
            unitsPerPixel={unitsPerPixel}
            tool={props.tool}
            style={props.style}
            selection={props.selection}
            onSelection={props.onSelection}
            document={props.document}
            author={props.author}
            onDraft={setDraft}
            onText={props.onTextDraft}
            panning={props.panning}
          />
        ) : null}
        {compare
          ? null
          : props.peers.map((peer) =>
              peer.pointer ? (
                <LivePointer
                  key={peer.clientId}
                  name={peer.user.name}
                  tone={peer.user.tone}
                  {...pointerAt(toBox(peer.pointer))}
                />
              ) : null,
            )}
        <TextBox
          draft={props.textDraft}
          anchor={props.textDraft ? toBox(props.textDraft.at) : null}
          onChange={props.onTextDraft}
          onDone={(draft) => {
            props.onTextDraft(null);
            const text = draft.text.replace(/\s+$/, "");
            if (draft.markId) {
              const id = draft.markId;
              props.document.change((current) => {
                const mark = current.marks[id];
                if (!mark || mark.kind !== "text") return current;
                const marks = { ...current.marks };
                if (text) marks[id] = { ...mark, text };
                else delete marks[id];
                return { ...current, marks };
              });
              if (!text) props.onSelection(props.selection.filter((selected) => selected !== id));
              return;
            }
            if (!text) return;
            const id = newMarkId();
            props.document.change((current) => ({
              ...current,
              marks: {
                ...current.marks,
                [id]: {
                  id,
                  kind: "text",
                  z: topZ(current.marks) + 1,
                  color: props.style.color,
                  size: props.style.text,
                  at: draft.at,
                  text,
                  ...(props.author ? { author: props.author } : {}),
                },
              },
            }));
            props.onSelection([id]);
          }}
        />
      </div>
    </Surface>
  );
}

const pointerAt = (point: { x: number; y: number }) => ({ left: point.x, top: point.y });
