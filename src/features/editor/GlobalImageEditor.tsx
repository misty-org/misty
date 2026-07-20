import type {
  ImageTool,
  ImagePoint,
  ImageCrop,
} from "@/models/types/features/editor/GlobalImageEditor";
export type {
  ImageTool,
  ImagePoint,
  ImageCrop,
} from "@/models/types/features/editor/GlobalImageEditor";
import type { GlobalImageEditorProps } from "@/models/interfaces/features/editor/GlobalImageEditor";
export type { GlobalImageEditorProps } from "@/models/interfaces/features/editor/GlobalImageEditor";
import {
  ChevronDown,
  Copy,
  Crop,
  FlipHorizontal2,
  FlipVertical2,
  Loader2,
  Minus,
  MousePointer2,
  Paintbrush,
  Pipette,
  Plus,
  Redo2,
  RotateCcw,
  RotateCw,
  Save,
  Shapes,
  Type,
  Undo2,
  X,
} from "lucide-react";
import { Image as TauriImage } from "@tauri-apps/api/image";
import { writeImage } from "@tauri-apps/plugin-clipboard-manager";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import { Button } from "@/ui";
import { Input } from "@/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui";
import { Slider } from "@/ui";
import { defaultGlobalImageEdit, normalizeGlobalImageEdit } from "@/features/editor/imageEditor";
import type {
  GlobalImageEditDefinition,
  GlobalImageMarkupElement,
} from "@/models/interfaces/features/editor/imageEditor";

export function GlobalImageEditor(props: GlobalImageEditorProps) {
  const initial = useMemo(() => normalizeGlobalImageEdit(props.initialEdit), [props.sourceKey]);
  const [history, setHistory] = useState<GlobalImageEditDefinition[]>([initial]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const edit = history[historyIndex] ?? initial;
  const [activeTool, setActiveTool] = useState<ImageTool>("selection");
  const [brushColor, setBrushColor] = useState("#ffffff");
  const [brushSize, setBrushSize] = useState(6);
  const [annotationText, setAnnotationText] = useState("Text");
  const [zoom, setZoom] = useState(100);
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
  const [liveMarkup, setLiveMarkup] = useState<GlobalImageMarkupElement | null>(null);
  const liveMarkupRef = useRef<GlobalImageMarkupElement | null>(null);
  const cropStartRef = useRef<ImagePoint | null>(null);
  const [saving, setSaving] = useState<"save" | "copy" | "clipboard" | null>(null);
  const [saveMenuOpen, setSaveMenuOpen] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [saveError, setSaveError] = useState("");
  const [decodeError, setDecodeError] = useState("");
  const [tags, setTags] = useState<string[]>(props.tags ?? []);
  const [tagDraft, setTagDraft] = useState("");
  const [editingTag, setEditingTag] = useState<number | null>(null);
  const [editingTagValue, setEditingTagValue] = useState("");
  const [tagsSaving, setTagsSaving] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const saveMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!saveMenuOpen) return;
    const closeMenu = (event: MouseEvent) => {
      if (!saveMenuRef.current?.contains(event.target as Node)) setSaveMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSaveMenuOpen(false);
    };
    document.addEventListener("mousedown", closeMenu);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeMenu);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [saveMenuOpen]);

  useEffect(() => {
    const next = normalizeGlobalImageEdit(props.initialEdit);
    setHistory([next]);
    setHistoryIndex(0);
    setActiveTool("selection");
    setZoom(100);
    setTags(props.tags ?? []);
    setTagDraft("");
    setEditingTag(null);
    setSaveMessage("");
    setSaveError("");
    setDecodeError("");
    setSaveMenuOpen(false);
  }, [props.sourceKey]);

  useEffect(() => {
    let current = true;
    setDecodeError("");
    if (!props.url)
      return () => {
        current = false;
      };
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      if (!current) return;
      imageRef.current = image;
      setImageDimensions({ width: image.naturalWidth, height: image.naturalHeight });
      setDecodeError("");
      renderGlobalImageEdit(canvasRef.current, image, edit, liveMarkup);
    };
    image.onerror = () => {
      if (current) setDecodeError("The image could not be decoded for editing.");
    };
    image.src = props.url;
    return () => {
      current = false;
      image.onload = null;
      image.onerror = null;
    };
  }, [props.url]);

  useEffect(() => {
    if (imageRef.current)
      renderGlobalImageEdit(canvasRef.current, imageRef.current, edit, liveMarkup);
  }, [edit, liveMarkup]);

  const pushEdit = useCallback(
    (change: (current: GlobalImageEditDefinition) => GlobalImageEditDefinition) => {
      setHistory((current) => {
        const next = [
          ...current.slice(0, historyIndex + 1),
          change(current[historyIndex] ?? defaultGlobalImageEdit()),
        ];
        setHistoryIndex(next.length - 1);
        return next;
      });
      setSaveMessage("");
    },
    [historyIndex],
  );

  const undo = () => setHistoryIndex((value) => Math.max(0, value - 1));
  const redo = () => setHistoryIndex((value) => Math.min(history.length - 1, value + 1));
  const dirty = historyIndex > 0;
  const editIsDefault = JSON.stringify(edit) === JSON.stringify(defaultGlobalImageEdit());
  const tagsDirty = JSON.stringify(tags) !== JSON.stringify(props.tags ?? []);
  const editorError = saveError || decodeError;

  const resetEditor = () => {
    setZoom(100);
    if (!editIsDefault) pushEdit(() => defaultGlobalImageEdit());
  };

  const pointFromEvent = (event: PointerEvent<HTMLCanvasElement>): ImagePoint => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: clamp01((event.clientX - bounds.left) / Math.max(1, bounds.width)),
      y: clamp01((event.clientY - bounds.top) / Math.max(1, bounds.height)),
    };
  };

  const beginGesture = (event: PointerEvent<HTMLCanvasElement>) => {
    if (props.readonly || activeTool === "selection") return;
    const point = pointFromEvent(event);
    if (activeTool === "eyedropper") {
      try {
        const context = event.currentTarget.getContext("2d", { willReadFrequently: true });
        if (!context) return;
        const pixel = context.getImageData(
          Math.min(
            event.currentTarget.width - 1,
            Math.max(0, Math.floor(point.x * event.currentTarget.width)),
          ),
          Math.min(
            event.currentTarget.height - 1,
            Math.max(0, Math.floor(point.y * event.currentTarget.height)),
          ),
          1,
          1,
        ).data;
        setBrushColor(rgbToHex(pixel[0], pixel[1], pixel[2]));
        setActiveTool("brush");
      } catch {
        setSaveError("That pixel could not be sampled. Try another point on the image.");
      }
      return;
    }
    if (activeTool === "text") {
      pushEdit((current) => ({
        ...current,
        markup: [
          ...current.markup,
          {
            kind: "text",
            x: point.x,
            y: point.y,
            color: brushColor,
            line_width: brushSize / 500,
            opacity: 1,
            text: annotationText.trim() || "Text",
          },
        ],
      }));
      return;
    }
    if (activeTool === "crop") cropStartRef.current = point;
    if (activeTool === "brush") {
      const markup: GlobalImageMarkupElement = {
        kind: "stroke",
        points: [point],
        color: brushColor,
        line_width: brushSize / 500,
        opacity: 1,
      };
      liveMarkupRef.current = markup;
      setLiveMarkup(markup);
    }
    if (activeTool === "shape") {
      const markup: GlobalImageMarkupElement = {
        kind: "rectangle",
        points: [point],
        x: point.x,
        y: point.y,
        width: 0.001,
        height: 0.001,
        color: brushColor,
        line_width: brushSize / 500,
        opacity: 1,
      };
      liveMarkupRef.current = markup;
      setLiveMarkup(markup);
    }
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const continueGesture = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const point = pointFromEvent(event);
    const current = liveMarkupRef.current;
    if (!current) return;
    let next = current;
    if (current.kind === "stroke")
      next = { ...current, points: [...(current.points ?? []).slice(0, 255), point] };
    if (current.kind === "rectangle") {
      const start = current.points?.[0] ?? point;
      next = {
        ...current,
        x: Math.min(start.x, point.x),
        y: Math.min(start.y, point.y),
        width: Math.abs(point.x - start.x),
        height: Math.abs(point.y - start.y),
      };
    }
    liveMarkupRef.current = next;
    setLiveMarkup(next);
  };

  const finishGesture = (event: PointerEvent<HTMLCanvasElement>) => {
    const point = pointFromEvent(event);
    const markup = liveMarkupRef.current;
    if (
      markup &&
      (markup.kind !== "rectangle" || ((markup.width ?? 0) > 0.004 && (markup.height ?? 0) > 0.004))
    )
      pushEdit((current) => ({ ...current, markup: [...current.markup, markup] }));
    const cropStart = cropStartRef.current;
    if (cropStart) {
      const selected = normalizedRect(cropStart, point);
      if (selected.width > 0.02 && selected.height > 0.02)
        pushEdit((current) => ({
          ...current,
          crop: composeCrop(current.crop, selected),
          markup: [],
        }));
    }
    liveMarkupRef.current = null;
    cropStartRef.current = null;
    setLiveMarkup(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const renderBlob = () => canvasBlob(canvasRef.current, props.outputMimeType ?? "image/png");
  const performSave = async (copy: boolean) => {
    if (saving || props.readonly || (!copy && !dirty)) return;
    setSaving(copy ? "copy" : "save");
    setSaveError("");
    setSaveMessage("");
    try {
      const blob = await renderBlob();
      if (copy) await props.onSaveAsCopy(edit, blob);
      else await props.onSave(edit, blob);
      setSaveMessage(copy ? "Copy saved" : "Saved");
      if (!copy) {
        setHistory([edit]);
        setHistoryIndex(0);
      }
    } catch (reason) {
      setSaveError(reason instanceof Error ? reason.message : "The image could not be saved.");
    } finally {
      setSaving(null);
    }
  };

  const copyToClipboard = async () => {
    if (saving || props.loading || props.error) return;
    setSaving("clipboard");
    setSaveError("");
    setSaveMessage("");
    try {
      const blob = await canvasBlob(canvasRef.current, "image/png");
      const image = await TauriImage.fromBytes(await blob.arrayBuffer());
      try {
        await writeImage(image);
      } finally {
        await image.close();
      }
      setSaveMessage("Copied to clipboard");
    } catch (reason) {
      setSaveError(
        reason instanceof Error ? reason.message : "The edited image could not be copied.",
      );
    } finally {
      setSaving(null);
    }
  };

  const addTag = (value = tagDraft) => {
    const next = value.trim().replace(/^#/, "");
    if (!next || tags.some((tag) => tag.toLocaleLowerCase() === next.toLocaleLowerCase())) {
      setTagDraft("");
      return;
    }
    setTags((current) => [...current, next]);
    setTagDraft("");
  };
  const saveTags = async () => {
    if (!props.onSaveTags || tagsSaving || !tagsDirty) return;
    setTagsSaving(true);
    setSaveError("");
    try {
      await props.onSaveTags(tags);
      setSaveMessage("Tags saved");
    } catch (reason) {
      setSaveError(reason instanceof Error ? reason.message : "Tags could not be saved.");
    } finally {
      setTagsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[2147483300] bg-[#0b0c0f] text-white" role="presentation">
      <section
        className="grid h-full min-h-0 grid-rows-[56px_minmax(0,1fr)]"
        role="dialog"
        aria-modal="true"
        aria-label={`Edit ${props.name}`}
      >
        <header className="grid min-w-0 grid-cols-[minmax(140px,1fr)_auto_minmax(52px,1fr)] items-center border-b border-white/[0.06] bg-[#111216] px-3">
          <div className="min-w-0">
            <h1 className="m-0 truncate !text-[13px] !font-medium !leading-5 text-white/90">
              {props.name}
            </h1>
            {props.indexLabel ? (
              <span className="block text-[10px] text-white/40">{props.indexLabel}</span>
            ) : null}
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <div
              className="flex h-10 items-center overflow-hidden rounded-xl bg-[#f0f1f4] text-[#15171a] shadow-lg"
              data-editor-history-tray
            >
              <Button
                variant="ghost"
                size="icon"
                className="size-10 rounded-none border-r border-black/10 text-[#15171a] hover:bg-white hover:text-[#15171a]"
                aria-label="Undo"
                disabled={historyIndex === 0}
                onClick={undo}
              >
                <Undo2 size={17} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-10 rounded-none border-r border-black/10 text-[#15171a] hover:bg-white hover:text-[#15171a]"
                aria-label="Redo"
                disabled={historyIndex >= history.length - 1}
                onClick={redo}
              >
                <Redo2 size={17} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-10 rounded-none text-[#15171a] hover:bg-white hover:text-[#15171a]"
                aria-label="Zoom out"
                disabled={zoom <= 25}
                onClick={() => setZoom((value) => Math.max(25, value - 10))}
              >
                <Minus size={16} />
              </Button>
              <span
                className="min-w-12 text-center text-[11px] font-medium tabular-nums"
                aria-live="polite"
              >
                {zoom}%
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="size-10 rounded-none border-r border-black/10 text-[#15171a] hover:bg-white hover:text-[#15171a]"
                aria-label="Zoom in"
                disabled={zoom >= 300}
                onClick={() => setZoom((value) => Math.min(300, value + 10))}
              >
                <Plus size={16} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-10 rounded-none border-r border-black/10 text-[#15171a] hover:bg-white hover:text-[#15171a]"
                aria-label="Rotate clockwise"
                onClick={() =>
                  pushEdit((current) => ({
                    ...current,
                    rotation: nextRotation(current.rotation, 90),
                  }))
                }
              >
                <RotateCw size={16} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-10 rounded-none text-[#15171a] hover:bg-white hover:text-[#15171a]"
                aria-label="Reset editor"
                disabled={editIsDefault && zoom === 100}
                onClick={resetEditor}
              >
                <RotateCcw size={16} />
              </Button>
            </div>
            <div className="relative" ref={saveMenuRef} data-editor-save-menu>
              <Button
                className="h-10 rounded-xl bg-[#e7edf3] text-xs font-semibold text-[#17191c] shadow-lg hover:bg-white hover:text-[#17191c]"
                disabled={Boolean(saving)}
                aria-haspopup="menu"
                aria-expanded={saveMenuOpen}
                onClick={() => setSaveMenuOpen((open) => !open)}
              >
                <Save size={15} />
                <span>Save</span>
                <ChevronDown size={14} />
              </Button>
              {saveMenuOpen ? (
                <div
                  className="absolute right-0 top-[calc(100%+8px)] z-50 grid min-w-48 gap-1 overflow-hidden rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-2xl"
                  role="menu"
                  aria-label="Save options"
                >
                  <Button
                    type="button"
                    variant="ghost"
                    role="menuitem"
                    disabled={Boolean(saving) || props.readonly}
                    className="h-9 w-full justify-start text-xs"
                    onClick={() => {
                      setSaveMenuOpen(false);
                      void performSave(true);
                    }}
                  >
                    {saving === "copy" ? (
                      <Loader2 className="animate-spin" size={14} />
                    ) : (
                      <Copy size={14} />
                    )}
                    Save as copy
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    role="menuitem"
                    disabled={!dirty || Boolean(saving) || props.readonly}
                    className="h-9 w-full justify-start text-xs"
                    onClick={() => {
                      setSaveMenuOpen(false);
                      void performSave(false);
                    }}
                  >
                    {saving === "save" ? (
                      <Loader2 className="animate-spin" size={14} />
                    ) : (
                      <Save size={14} />
                    )}
                    Save
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    role="menuitem"
                    disabled={Boolean(saving) || props.loading || Boolean(props.error)}
                    className="h-9 w-full justify-start text-xs"
                    onClick={() => {
                      setSaveMenuOpen(false);
                      void copyToClipboard();
                    }}
                  >
                    {saving === "clipboard" ? (
                      <Loader2 className="animate-spin" size={14} />
                    ) : (
                      <Copy size={14} />
                    )}
                    Copy to clipboard
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
          <div className="flex min-w-0 items-center justify-end">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-10 shrink-0 rounded-xl bg-white/[0.08] text-white/60 hover:bg-white/15 hover:text-white"
              aria-label="Close editor"
              onClick={props.onClose}
            >
              <X size={19} />
            </Button>
          </div>
        </header>

        <div className="grid min-h-0 grid-cols-[84px_minmax(0,1fr)_340px] max-[900px]:grid-cols-[76px_minmax(0,1fr)]">
          <nav
            className="flex min-h-0 flex-col items-center overflow-y-auto border-r border-white/[0.06] bg-[#111216] px-2 py-3"
            aria-label="Image editing tools"
          >
            <div className="grid w-full justify-items-center gap-1.5">
              <ImageToolButton
                tool="selection"
                label="Selection"
                active={activeTool === "selection"}
                onClick={setActiveTool}
              >
                <MousePointer2 size={20} />
              </ImageToolButton>
              <ImageToolButton
                tool="crop"
                label="Crop"
                active={activeTool === "crop"}
                onClick={setActiveTool}
              >
                <Crop size={20} />
              </ImageToolButton>
              <ImageToolButton
                tool="text"
                label="Text"
                active={activeTool === "text"}
                onClick={setActiveTool}
              >
                <Type size={21} />
              </ImageToolButton>
              <ImageToolButton
                tool="brush"
                label="Brush"
                active={activeTool === "brush"}
                onClick={setActiveTool}
              >
                <Paintbrush size={20} />
              </ImageToolButton>
              <ImageToolButton
                tool="eyedropper"
                label="Eyedropper"
                active={activeTool === "eyedropper"}
                onClick={setActiveTool}
              >
                <Pipette size={20} />
              </ImageToolButton>
              <ImageToolButton
                tool="shape"
                label="Shape"
                active={activeTool === "shape"}
                onClick={setActiveTool}
              >
                <Shapes size={21} />
              </ImageToolButton>
            </div>
            <div className="mt-3 grid w-full justify-items-center gap-2.5 border-t border-white/[0.06] pt-3">
              <label
                className="relative grid cursor-pointer justify-items-center gap-1 text-[9px] text-white/45"
                title={`Brush color ${brushColor}`}
              >
                <span
                  className="size-7 rounded-full border-2 border-white/30 shadow"
                  style={{ backgroundColor: brushColor }}
                />
                <span className="font-mono text-[8px] uppercase">{brushColor}</span>
                <Input
                  aria-label="Brush color"
                  className="absolute inset-0 cursor-pointer opacity-0"
                  type="color"
                  value={brushColor}
                  onChange={(event) => setBrushColor(event.target.value)}
                />
              </label>
              <label className="grid w-16 justify-items-center gap-1 text-[9px] text-white/45">
                Size
                <Slider
                  aria-label="Brush size"
                  value={[brushSize]}
                  min={2}
                  max={18}
                  onValueChange={([value]) => setBrushSize(value ?? brushSize)}
                />
              </label>
            </div>
          </nav>

          <main className="relative grid min-h-0 grid-rows-[minmax(0,1fr)_42px] overflow-hidden bg-[#08090b]">
            <div className="relative grid min-h-0 place-items-center overflow-auto p-6">
              {props.loading ? (
                <div className="grid justify-items-center gap-3 text-sm text-white/50">
                  <Loader2 className="animate-spin" size={28} />
                  Preparing image…
                </div>
              ) : null}
              {props.error ? (
                <p className="max-w-sm text-center text-sm text-red-200">{props.error}</p>
              ) : null}
              {!props.loading && !props.error ? (
                <canvas
                  ref={canvasRef}
                  className={`block max-h-full max-w-full touch-none object-contain shadow-[0_24px_80px_rgba(0,0,0,.55)] ${activeTool === "selection" ? "cursor-default" : activeTool === "eyedropper" ? "cursor-copy" : "cursor-crosshair"}`}
                  style={{ transform: `scale(${zoom / 100})`, transformOrigin: "center" }}
                  aria-label={`Editable preview of ${props.name}`}
                  onPointerDown={beginGesture}
                  onPointerMove={continueGesture}
                  onPointerUp={finishGesture}
                  onPointerCancel={finishGesture}
                />
              ) : null}
            </div>
            <footer className="flex items-center justify-center border-t border-white/[0.06] bg-[#101115] px-3 text-[11px] text-white/50">
              <span>
                {imageDimensions.width && imageDimensions.height
                  ? `${imageDimensions.width} × ${imageDimensions.height}`
                  : "—"}
              </span>
            </footer>
          </main>

          <aside className="min-h-0 overflow-y-auto border-l border-white/[0.06] bg-[#141519] p-5 max-[900px]:hidden">
            <section className="border-b border-white/[0.06] pb-5">
              <div className="flex items-center justify-between">
                <h2 className="m-0 !text-sm !font-medium">Tags</h2>
                {props.onSaveTags ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-[10px] text-white/60 hover:bg-white/[0.07] hover:text-white"
                    disabled={!tagsDirty || tagsSaving}
                    onClick={() => void saveTags()}
                  >
                    {tagsSaving ? "Saving…" : "Save tags"}
                  </Button>
                ) : null}
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {tags.map((tag, index) =>
                  editingTag === index ? (
                    <Input
                      key={`${tag}:${index}`}
                      autoFocus
                      className="h-7 w-24 rounded-full border-white/20 bg-black/30 px-2.5 text-[10px] text-white"
                      value={editingTagValue}
                      onChange={(event) => setEditingTagValue(event.target.value)}
                      onBlur={() => {
                        const next = editingTagValue.trim();
                        if (next)
                          setTags((current) =>
                            current.map((value, candidate) => (candidate === index ? next : value)),
                          );
                        setEditingTag(null);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                        if (event.key === "Escape") setEditingTag(null);
                      }}
                    />
                  ) : (
                    <span
                      className="inline-flex h-7 items-center overflow-hidden rounded-full border border-white/10 bg-white/[0.07] text-[10px] text-white/80"
                      key={`${tag}:${index}`}
                    >
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-full rounded-none px-2.5 text-[10px] text-white/80 hover:bg-white/[0.06] hover:text-white"
                        onClick={() => {
                          setEditingTag(index);
                          setEditingTagValue(tag);
                        }}
                        title={`Edit ${tag}`}
                      >
                        {tag}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-full w-7 rounded-none border-l border-white/10 text-white/45 hover:bg-red-400/15 hover:text-red-200"
                        onClick={() =>
                          setTags((current) =>
                            current.filter((_, candidate) => candidate !== index),
                          )
                        }
                        aria-label={`Delete tag ${tag}`}
                      >
                        <X size={11} />
                      </Button>
                    </span>
                  ),
                )}
              </div>
              {props.onSaveTags ? (
                <div className="mt-3 flex gap-2">
                  <Input
                    className="h-8 min-w-0 flex-1 border-white/[0.08] bg-white/[0.05] text-xs text-white focus-visible:ring-white/20"
                    value={tagDraft}
                    onChange={(event) => setTagDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === ",") {
                        event.preventDefault();
                        addTag();
                      }
                    }}
                    placeholder="Add a tag"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 bg-white/[0.08] text-white/70 hover:bg-white/15 hover:text-white"
                    onClick={() => addTag()}
                    aria-label="Add tag"
                  >
                    <Plus size={14} />
                  </Button>
                </div>
              ) : null}
            </section>

            <section className="pt-5">
              <div className="flex items-center justify-between">
                <h2 className="m-0 !text-sm !font-medium">Edit</h2>
              </div>
              {activeTool === "brush" || activeTool === "shape" || activeTool === "text" ? (
                <div className="mt-4 grid gap-2 rounded-xl border border-white/[0.07] bg-white/[0.03] p-3">
                  <div className="flex items-center justify-between text-[10px] text-white/50">
                    <span>{activeTool === "text" ? "Text color" : "Brush color"}</span>
                    <span className="flex items-center gap-2 font-mono uppercase text-white/75">
                      <i
                        className="size-4 rounded-full border border-white/20"
                        style={{ backgroundColor: brushColor }}
                      />
                      {brushColor}
                    </span>
                  </div>
                  {activeTool === "text" ? (
                    <Input
                      className="h-8 bg-black/25 text-xs text-white"
                      value={annotationText}
                      onChange={(event) => setAnnotationText(event.target.value)}
                      placeholder="Text to place"
                    />
                  ) : (
                    <EditorRange
                      label="Brush size"
                      value={brushSize}
                      min={2}
                      max={18}
                      step={1}
                      display={String(brushSize)}
                      onChange={setBrushSize}
                    />
                  )}
                </div>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-2">
                <EditorActionButton
                  onClick={() =>
                    pushEdit((current) => ({
                      ...current,
                      flip_horizontal: !current.flip_horizontal,
                    }))
                  }
                >
                  <FlipHorizontal2 size={13} />
                  Flip H
                </EditorActionButton>
                <EditorActionButton
                  onClick={() =>
                    pushEdit((current) => ({ ...current, flip_vertical: !current.flip_vertical }))
                  }
                >
                  <FlipVertical2 size={13} />
                  Flip V
                </EditorActionButton>
                <EditorActionButton
                  onClick={() =>
                    pushEdit((current) => ({ ...current, auto_enhance: !current.auto_enhance }))
                  }
                >
                  {edit.auto_enhance ? "Auto on" : "Auto"}
                </EditorActionButton>
              </div>
              <label className="mt-4 grid gap-1.5 text-[10px] text-white/50">
                Filter
                <Select
                  value={edit.filter || "none"}
                  onValueChange={(value) =>
                    pushEdit((current) => ({
                      ...current,
                      filter:
                        value === "none" ? "" : (value as GlobalImageEditDefinition["filter"]),
                    }))
                  }
                >
                  <SelectTrigger className="h-9 border-white/[0.07] bg-[#15161a] text-xs text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="vivid">Vivid</SelectItem>
                    <SelectItem value="dramatic">Dramatic</SelectItem>
                    <SelectItem value="warm">Warm</SelectItem>
                    <SelectItem value="cool">Cool</SelectItem>
                    <SelectItem value="mono">Mono</SelectItem>
                    <SelectItem value="noir">Noir</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <EditorRange
                label="Brightness"
                value={edit.brightness}
                min={0}
                max={2}
                step={0.05}
                onChange={(value) => pushEdit((current) => ({ ...current, brightness: value }))}
              />
              <EditorRange
                label="Contrast"
                value={edit.contrast}
                min={0}
                max={2}
                step={0.05}
                onChange={(value) => pushEdit((current) => ({ ...current, contrast: value }))}
              />
              <EditorRange
                label="Saturation"
                value={edit.saturation}
                min={0}
                max={2}
                step={0.05}
                onChange={(value) => pushEdit((current) => ({ ...current, saturation: value }))}
              />
              <EditorRange
                label="Grayscale"
                value={edit.grayscale}
                min={0}
                max={1}
                step={0.05}
                onChange={(value) => pushEdit((current) => ({ ...current, grayscale: value }))}
              />
              <details className="mt-4 rounded-xl border border-white/[0.06] px-3 py-2">
                <summary className="cursor-pointer text-[10px] text-white/45">
                  Advanced Adjustments
                </summary>
                <EditorRange
                  label="Exposure"
                  value={edit.exposure}
                  min={-2}
                  max={2}
                  step={0.05}
                  onChange={(value) => pushEdit((current) => ({ ...current, exposure: value }))}
                />
                <EditorRange
                  label="Vibrance"
                  value={edit.vibrance}
                  min={-1}
                  max={1}
                  step={0.05}
                  onChange={(value) => pushEdit((current) => ({ ...current, vibrance: value }))}
                />
                <EditorRange
                  label="Warmth"
                  value={edit.warmth}
                  min={-1}
                  max={1}
                  step={0.05}
                  onChange={(value) => pushEdit((current) => ({ ...current, warmth: value }))}
                />
                <EditorRange
                  label="Tint"
                  value={edit.tint}
                  min={-1}
                  max={1}
                  step={0.05}
                  onChange={(value) => pushEdit((current) => ({ ...current, tint: value }))}
                />
                <EditorRange
                  label="Vignette"
                  value={edit.vignette}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={(value) => pushEdit((current) => ({ ...current, vignette: value }))}
                />
              </details>
              <div className="mt-4">
                <p className="m-0 text-[10px] text-white/45">Crop &amp; Straighten</p>
                <EditorRange
                  label="Straighten"
                  value={edit.straighten}
                  min={-45}
                  max={45}
                  step={0.5}
                  onChange={(value) => pushEdit((current) => ({ ...current, straighten: value }))}
                />
                <div className="mt-2 flex gap-1">
                  <EditorActionButton
                    onClick={() => pushEdit((current) => ({ ...current, crop: undefined }))}
                  >
                    Original
                  </EditorActionButton>
                  <EditorActionButton
                    onClick={() =>
                      pushEdit((current) => ({
                        ...current,
                        crop: { x: 0.125, y: 0, width: 0.75, height: 1 },
                        markup: [],
                      }))
                    }
                  >
                    Square
                  </EditorActionButton>
                  <EditorActionButton
                    onClick={() =>
                      pushEdit((current) => ({
                        ...current,
                        crop: { x: 0, y: 0.125, width: 1, height: 0.75 },
                        markup: [],
                      }))
                    }
                  >
                    Wide
                  </EditorActionButton>
                </div>
              </div>
              {saveMessage || editorError ? (
                <p
                  className={`mb-0 mt-4 rounded-lg px-3 py-2 text-xs ${editorError ? "bg-red-500/10 text-red-200" : "bg-emerald-500/10 text-emerald-200"}`}
                  role="status"
                >
                  {editorError || saveMessage}
                </p>
              ) : null}
              <div className="mt-5 grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 border-white/[0.08] bg-white/[0.08] text-white/80 hover:bg-white/15 hover:text-white"
                  onClick={props.onCancel ?? props.onClose}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={!dirty || Boolean(saving) || props.readonly}
                  className="h-10 bg-[#e7edf3] text-[#17191c] hover:bg-white hover:text-[#17191c]"
                  onClick={() => void performSave(false)}
                >
                  {saving === "save" ? "Saving…" : "Save edit"}
                </Button>
              </div>
            </section>
          </aside>
        </div>
      </section>
    </div>
  );
}

function ImageToolButton(props: {
  tool: ImageTool;
  label: string;
  active: boolean;
  onClick: (tool: ImageTool) => void;
  children: ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      type="button"
      aria-label={props.label}
      aria-pressed={props.active}
      onClick={() => props.onClick(props.tool)}
      className={`grid size-16 shrink-0 place-items-center content-center gap-1 rounded-xl p-1 text-[9px] ${props.active ? "bg-white/[0.11] text-white" : "text-white/65 hover:bg-white/[0.06] hover:text-white"}`}
    >
      {props.children}
      <span className="max-w-full truncate">{props.label}</span>
    </Button>
  );
}

function EditorRange(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="mt-4 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-[10px] text-white/45">
      <span>{props.label}</span>
      <span>{props.display ?? props.value.toFixed(2)}</span>
      <Slider
        className="col-span-2"
        value={[props.value]}
        min={props.min}
        max={props.max}
        step={props.step}
        onValueChange={([value]) => props.onChange(value ?? props.value)}
      />
    </label>
  );
}

function EditorActionButton(props: { children: ReactNode; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-9 bg-white/[0.08] text-xs text-white/65 hover:bg-white/15 hover:text-white"
      onClick={props.onClick}
    >
      {props.children}
    </Button>
  );
}

function nextRotation(
  rotation: GlobalImageEditDefinition["rotation"],
  amount: number,
): GlobalImageEditDefinition["rotation"] {
  return ((rotation + amount + 360) % 360) as GlobalImageEditDefinition["rotation"];
}
function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}
function normalizedRect(start: ImagePoint, end: ImagePoint): ImageCrop {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}
function composeCrop(existing: ImageCrop | undefined, selected: ImageCrop): ImageCrop {
  const base = existing ?? { x: 0, y: 0, width: 1, height: 1 };
  return {
    x: base.x + selected.x * base.width,
    y: base.y + selected.y * base.height,
    width: selected.width * base.width,
    height: selected.height * base.height,
  };
}
function rgbToHex(red: number, green: number, blue: number) {
  return `#${[red, green, blue].map((value) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0")).join("")}`;
}

function renderGlobalImageEdit(
  canvas: HTMLCanvasElement | null,
  image: HTMLImageElement,
  edit: GlobalImageEditDefinition,
  liveMarkup: GlobalImageMarkupElement | null,
) {
  if (!canvas || !image.naturalWidth || !image.naturalHeight) return;
  const quarterTurn = Math.abs(Math.round(edit.rotation / 90)) % 2 === 1;
  const staging = document.createElement("canvas");
  staging.width = quarterTurn ? image.naturalHeight : image.naturalWidth;
  staging.height = quarterTurn ? image.naturalWidth : image.naturalHeight;
  const stagingContext = staging.getContext("2d");
  if (!stagingContext) return;
  stagingContext.save();
  stagingContext.translate(staging.width / 2, staging.height / 2);
  stagingContext.rotate(((edit.rotation + edit.straighten) * Math.PI) / 180);
  stagingContext.scale(edit.flip_horizontal ? -1 : 1, edit.flip_vertical ? -1 : 1);
  stagingContext.filter = imageFilter(edit);
  stagingContext.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
  stagingContext.restore();
  const crop = edit.crop ?? { x: 0, y: 0, width: 1, height: 1 };
  const sourceX = Math.round(crop.x * staging.width),
    sourceY = Math.round(crop.y * staging.height);
  const sourceWidth = Math.max(1, Math.round(crop.width * staging.width)),
    sourceHeight = Math.max(1, Math.round(crop.height * staging.height));
  canvas.width = sourceWidth;
  canvas.height = sourceHeight;
  const context = canvas.getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(
    staging,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  for (const markup of edit.markup) drawMarkup(context, markup, canvas.width, canvas.height);
  if (liveMarkup) drawMarkup(context, liveMarkup, canvas.width, canvas.height);
  if (edit.vignette > 0) {
    const gradient = context.createRadialGradient(
      canvas.width / 2,
      canvas.height / 2,
      Math.min(canvas.width, canvas.height) * 0.2,
      canvas.width / 2,
      canvas.height / 2,
      Math.max(canvas.width, canvas.height) * 0.7,
    );
    gradient.addColorStop(0, "rgba(0,0,0,0)");
    gradient.addColorStop(1, `rgba(0,0,0,${Math.min(0.75, edit.vignette * 0.65)})`);
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
}

function imageFilter(edit: GlobalImageEditDefinition) {
  const preset =
    edit.filter === "vivid"
      ? "contrast(1.08) saturate(1.28)"
      : edit.filter === "dramatic"
        ? "contrast(1.25) saturate(.82) brightness(.92)"
        : edit.filter === "warm"
          ? "sepia(.12) saturate(1.08)"
          : edit.filter === "cool"
            ? "hue-rotate(8deg) saturate(1.05)"
            : edit.filter === "mono"
              ? "grayscale(1)"
              : edit.filter === "noir"
                ? "grayscale(1) contrast(1.35) brightness(.96)"
                : "";
  const enhance = edit.auto_enhance ? "contrast(1.05) saturate(1.08) brightness(1.02)" : "";
  return `brightness(${edit.brightness + edit.exposure * 0.125 + edit.brilliance * 0.05 - edit.black_point * 0.04}) contrast(${edit.contrast * (1 + edit.highlights * 0.18 - edit.shadows * 0.08 + edit.black_point * 0.16)}) saturate(${edit.saturation * (1 + edit.vibrance * 0.5)}) grayscale(${edit.grayscale}) sepia(${Math.max(0, edit.warmth) * 0.08}) hue-rotate(${edit.tint * 8 - edit.warmth * 4}deg) blur(${edit.noise_reduction * 0.35}px) ${enhance} ${preset}`;
}

function drawMarkup(
  context: CanvasRenderingContext2D,
  markup: GlobalImageMarkupElement,
  width: number,
  height: number,
) {
  context.save();
  context.globalAlpha = markup.opacity;
  context.strokeStyle = markup.color;
  context.fillStyle = markup.color;
  context.lineWidth = Math.max(1, markup.line_width * Math.min(width, height));
  context.lineCap = "round";
  context.lineJoin = "round";
  if (markup.kind === "stroke" || markup.kind === "highlight") {
    const points = markup.points ?? [];
    if (points.length) {
      context.beginPath();
      context.moveTo(points[0].x * width, points[0].y * height);
      for (const point of points.slice(1)) context.lineTo(point.x * width, point.y * height);
      context.stroke();
    }
  } else if (markup.kind === "rectangle" || markup.kind === "cleanup") {
    context.strokeRect(
      (markup.x ?? 0) * width,
      (markup.y ?? 0) * height,
      (markup.width ?? 0) * width,
      (markup.height ?? 0) * height,
    );
  } else if (markup.kind === "text") {
    context.font = `600 ${Math.max(14, markup.line_width * 4 * Math.min(width, height))}px ui-sans-serif, system-ui, sans-serif`;
    context.textBaseline = "top";
    context.fillText(markup.text ?? "Text", (markup.x ?? 0) * width, (markup.y ?? 0) * height);
  }
  context.restore();
}

function canvasBlob(canvas: HTMLCanvasElement | null, mimeType: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (!canvas) {
      reject(new Error("The image editor is not ready."));
      return;
    }
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("The edited image could not be encoded.")),
      mimeType,
      0.92,
    );
  });
}
