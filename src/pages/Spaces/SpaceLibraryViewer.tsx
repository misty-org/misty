import { useEffect, useMemo, useRef, useState, type FormEvent, type RefObject } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ClipboardCopy,
  Copy,
  EyeOff,
  Play,
  RotateCw,
  SlidersHorizontal,
  Star,
  Trash2,
  X,
} from "lucide-react";

import { GlobalImageEditor } from "@/components/GlobalImageEditor";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { confirmAction } from "@/shared/confirmAction";
import { copyLibraryItemsToClipboard } from "@/spaces/libraryClipboard";
import { spacesApi } from "@/spaces/api";
import type {
  LibraryAssetStack,
  LibraryEditDefinition,
  LibraryEditVersion,
  SpaceLibraryItem,
} from "@/spaces/types";

import { EmbeddedUniversalPreview } from "../Files/components/GlobalPreview";
import { MistyLibraryPicker } from "./components/MistyLibraryPicker";
import { formatBytes, formatTime } from "./libraryFormat";
import {
  LibrarySelect,
  libraryItemMIME,
} from "./SpaceLibraryPrimitives";
import {
  LibraryAdvancedAdjustments,
  LibraryEditRange,
  LibraryMetadataRow,
  createLongExposureImage,
  defaultLibraryEdit,
  libraryEditStyle,
  libraryRenditionStatus,
  normalizeLibraryEdit,
} from "./SpaceLibraryViewerUtils";

export function LibraryItemViewer({
  spaceId,
  item,
  items,
  allItems,
  assetStack,
  reauthenticationToken,
  canEdit,
  canCopy,
  returnFocusRef,
  onCopyEdit,
  onSetStackCover,
  onSetStackEffect,
  onUngroupStack,
  onClose,
  onSelect,
  onUpdate,
  onReplaceItem,
  onRenditionReady,
  onTrash,
}: {
  spaceId: string;
  item: SpaceLibraryItem | null;
  items: SpaceLibraryItem[];
  allItems: SpaceLibraryItem[];
  assetStack: LibraryAssetStack | null;
  reauthenticationToken: string;
  canEdit: boolean;
  canCopy: boolean;
  returnFocusRef: RefObject<HTMLElement | null>;
  onCopyEdit: (definition: LibraryEditDefinition) => void;
  onSetStackCover: (stack: LibraryAssetStack, coverItemID: string) => Promise<void>;
  onSetStackEffect: (stack: LibraryAssetStack, effect: LibraryAssetStack["effect"]) => Promise<void>;
  onUngroupStack: (stack: LibraryAssetStack) => Promise<void>;
  onClose: () => void;
  onSelect: (itemId: string) => void;
  onUpdate: (item: SpaceLibraryItem, patch: Partial<Pick<SpaceLibraryItem, "display_name" | "caption" | "favorite" | "hidden" | "tags">>) => Promise<SpaceLibraryItem | null>;
  onReplaceItem: (item: SpaceLibraryItem) => void;
  onRenditionReady: () => void;
  onTrash: (item: SpaceLibraryItem) => Promise<boolean>;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaAreaRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const bounceFrameRef = useRef(0);
  const [contentUrl, setContentUrl] = useState("");
  const [contentError, setContentError] = useState("");
  const [contentLoading, setContentLoading] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [caption, setCaption] = useState("");
  const [tags, setTags] = useState("");
  const [saving, setSaving] = useState(false);
  const [editVersions, setEditVersions] = useState<LibraryEditVersion[]>([]);
  const [editVersionsLoading, setEditVersionsLoading] = useState(false);
  const [editingAvailable, setEditingAvailable] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState<LibraryEditDefinition>(() => defaultLibraryEdit());
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const [stackMemberID, setStackMemberID] = useState("");
  const index = item ? items.findIndex((candidate) => candidate.id === item.id) : -1;
  const metadata = item?.file.intrinsic_metadata ?? {};
  const mimeType = item ? libraryItemMIME(item) : "application/octet-stream";
  const isImage = mimeType.startsWith("image/") || !mimeType.startsWith("video/") && Number(metadata.width ?? 0) > 0 && Number(metadata.height ?? 0) > 0;
  const isVideo = /^video\//.test(mimeType);
  const isAudio = /^audio\//.test(mimeType);
  const activeEdit = editVersions.find((version) => version.is_current) ?? null;
  const appliedEdit = editing ? editDraft : normalizeLibraryEdit(activeEdit?.edit_definition);
  const renditionReady = activeEdit?.rendition_state === "ready";
  const mediaStyle = renditionReady && !editing ? undefined : libraryEditStyle(appliedEdit);
  const stackMediaID = stackMemberID || item?.id || "";
  const stackMediaItem = allItems.find((candidate) => candidate.id === stackMediaID) ?? (item?.id === stackMediaID ? item : null);
  const stackMediaMember = assetStack?.members.find((member) => member.item_id === stackMediaID);
  const stackMediaMetadata = stackMediaItem?.file.intrinsic_metadata ?? {};
  const stackMediaMIME = stackMediaItem ? libraryItemMIME(stackMediaItem) : String(stackMediaMember?.mime_type ?? "application/octet-stream").split(";")[0].toLowerCase();
  const contentIsImage = stackMediaMIME.startsWith("image/") || !stackMediaMIME.startsWith("video/") && Number(stackMediaMetadata.width ?? 0) > 0 && Number(stackMediaMetadata.height ?? 0) > 0;
  const contentIsVideo = stackMediaMIME.startsWith("video/");
  const contentIsAudio = stackMediaMIME.startsWith("audio/");

  useEffect(() => {
    setStackMemberID("");
  }, [assetStack?.id, item?.id]);

  useEffect(() => () => window.cancelAnimationFrame(bounceFrameRef.current), []);

  useEffect(() => {
    if (!item) return;
    setDisplayName(item.display_name);
    setCaption(item.caption);
    setTags(item.tags.join(", "));
  }, [item?.id, item?.version]);

  useEffect(() => {
    if (!item || !isImage && !isVideo) {
      setEditVersions([]);
      setEditVersionsLoading(false);
      setEditingAvailable(false);
      return;
    }
    let current = true;
    setEditVersionsLoading(true);
    void spacesApi.editVersions(spaceId, item.id, reauthenticationToken).then((result) => {
      if (!current) return;
      setEditVersions(result.versions);
      setEditingAvailable(true);
      const selected = result.versions.find((version) => version.is_current);
      setEditDraft(normalizeLibraryEdit(selected?.edit_definition));
    }).catch(() => {
      if (!current) return;
      setEditVersions([]);
      setEditingAvailable(false);
    }).finally(() => {
      if (current) setEditVersionsLoading(false);
    });
    return () => { current = false; };
  }, [isImage, isVideo, item?.id, item?.version, reauthenticationToken, spaceId]);

  useEffect(() => {
    if (!item || !editVersions.some((version) => version.rendition_state === "queued" || version.rendition_state === "processing")) return;
    let current = true;
    const refresh = () => void spacesApi.editVersions(spaceId, item.id, reauthenticationToken).then((result) => {
      if (!current) return;
      const newlyReady = result.versions.some((version) => version.rendition_state === "ready" && editVersions.some((previous) => previous.id === version.id && previous.rendition_state !== "ready"));
      setEditVersions(result.versions);
      if (newlyReady) onRenditionReady();
    }).catch(() => undefined);
    const timer = window.setInterval(refresh, 1500);
    return () => { current = false; window.clearInterval(timer); };
  }, [editVersions, item?.id, onRenditionReady, reauthenticationToken, spaceId]);

  useEffect(() => {
    if (!item || !stackMediaID) {
      setContentUrl("");
      setContentError("");
      return;
    }
    let current = true;
    let objectUrl = "";
    setContentLoading(true);
    setContentError("");
    const showingCover = stackMediaID === item.id;
    const longExposureMotionID = assetStack?.kind === "live_photo" && assetStack.effect === "long_exposure" && showingCover ? assetStack.motion_item_id : "";
    const request = longExposureMotionID
      ? spacesApi.libraryContent(spaceId, longExposureMotionID, reauthenticationToken).then(createLongExposureImage)
      : (editing || isImage) && showingCover
		? contentIsImage ? spacesApi.libraryOriginalPreview(spaceId, stackMediaID, reauthenticationToken, stackMediaItem?.version ?? item.version).catch(() => spacesApi.libraryOriginalContent(spaceId, stackMediaID, reauthenticationToken)) : spacesApi.libraryOriginalContent(spaceId, stackMediaID, reauthenticationToken)
		: contentIsImage ? spacesApi.libraryPreview(spaceId, stackMediaID, reauthenticationToken, stackMediaItem?.version ?? item.version).catch(() => spacesApi.libraryContent(spaceId, stackMediaID, reauthenticationToken)) : spacesApi.libraryContent(spaceId, stackMediaID, reauthenticationToken);
    void request.then((blob) => {
      if (!current) return;
      objectUrl = URL.createObjectURL(blob);
      setContentUrl(objectUrl);
    }).catch((error: unknown) => current && setContentError(error instanceof Error ? error.message : "The file reader could not load this item.")).finally(() => current && setContentLoading(false));
    return () => {
      current = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [activeEdit?.rendition_state, assetStack?.effect, assetStack?.kind, assetStack?.motion_item_id, contentIsAudio, contentIsImage, contentIsVideo, editing, isImage, item?.id, item?.version, reauthenticationToken, spaceId, stackMediaID, stackMediaItem?.version]);

  useEffect(() => {
    if (isImage) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      if (event.key === "ArrowLeft" && index > 0) onSelect(items[index - 1].id);
      if (event.key === "ArrowRight" && index >= 0 && index < items.length - 1) onSelect(items[index + 1].id);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [index, isImage, items, onClose, onSelect]);

  if (!item) return null;

  const saveMetadata = async (event: FormEvent) => {
    event.preventDefault();
    const name = displayName.trim();
    if (!canEdit || !name || saving) return;
    setSaving(true);
    try {
      await onUpdate(item, { display_name: name, caption: caption.trim(), tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean) });
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async (definition: LibraryEditDefinition = editDraft) => {
    if (!canEdit || editSaving) return;
    setEditSaving(true);
    setEditError("");
    try {
      const result = await spacesApi.createEditVersion(spaceId, item, definition, reauthenticationToken);
      onReplaceItem(result.item);
      if (result.edit) {
        let savedVersion = { ...result.edit, is_current: true };
        setEditVersions((current) => [savedVersion, ...current.map((version) => ({ ...version, is_current: false }))]);
        try {
          const rendition = await spacesApi.renderEditVersion(spaceId, item.id, result.edit.id, 0, reauthenticationToken);
          savedVersion = { ...savedVersion, rendition_state: rendition.state };
          setEditVersions((current) => current.map((version) => version.id === savedVersion.id ? savedVersion : version));
        } catch (error) {
          setEditError(error instanceof Error ? `The edit was saved, but its media rendition could not start: ${error.message}` : "The edit was saved, but its media rendition could not start.");
        }
      }
      setEditing(false);
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "Edit could not be saved.");
    } finally {
      setEditSaving(false);
    }
  };

  const saveAsCopy = async (definition: LibraryEditDefinition = editDraft) => {
    if (!canEdit || editSaving) return;
    setEditSaving(true); setEditError("");
    try {
      const duplicated = await spacesApi.duplicateLibraryItems(spaceId, [item.id], reauthenticationToken);
      const copy = duplicated.items[0];
      if ((isImage || editing) && copy) {
        const edited = await spacesApi.createEditVersion(spaceId, copy, definition, reauthenticationToken);
        if (edited.edit) await spacesApi.renderEditVersion(spaceId, copy.id, edited.edit.id, 0, reauthenticationToken);
      }
      onRenditionReady();
    }
    catch (error) { setEditError(error instanceof Error ? error.message : "A copy could not be saved."); }
    finally { setEditSaving(false); }
  };

  const copyCurrentItem = async (target: SpaceLibraryItem = item) => {
    if (!canCopy) return;
    setEditError("");
    try {
      await copyLibraryItemsToClipboard(spaceId, [target], reauthenticationToken);
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "The Library item could not be copied.");
    }
  };

  const renderEdit = async (editID: string) => {
    if (!canEdit || editSaving) return;
    setEditSaving(true);
    setEditError("");
    try {
      const rendition = await spacesApi.renderEditVersion(spaceId, item.id, editID, 0, reauthenticationToken);
      setEditVersions((current) => current.map((version) => version.id === editID ? { ...version, rendition_state: rendition.state, rendition_error_code: undefined } : version));
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "The edit rendition could not start.");
    } finally {
      setEditSaving(false);
    }
  };

  const selectEdit = async (editID = "") => {
    if (!canEdit || editSaving) return;
    setEditSaving(true);
    setEditError("");
    try {
      const result = await spacesApi.selectEditVersion(spaceId, item, editID, reauthenticationToken);
      onReplaceItem(result.item);
      setEditVersions((current) => current.map((version) => ({ ...version, is_current: version.id === editID })));
      const selected = editVersions.find((version) => version.id === editID);
      setEditDraft(normalizeLibraryEdit(selected?.edit_definition));
      setEditing(false);
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "Version could not be selected.");
    } finally {
      setEditSaving(false);
    }
  };

  const deleteEdit = async (editID: string) => {
    if (!canEdit || editSaving || !await confirmAction("Delete this edit version?")) return;
    setEditSaving(true);
    try {
      await spacesApi.deleteEditVersion(spaceId, item.id, editID, reauthenticationToken);
      setEditVersions((current) => current.filter((version) => version.id !== editID));
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "Version could not be deleted.");
    } finally {
      setEditSaving(false);
    }
  };

  const beginEditing = () => {
    if (!canEdit) return;
    setEditDraft(normalizeLibraryEdit(activeEdit?.edit_definition));
    setEditing(true);
    setEditError("");
  };

  const handleVideoTime = () => {
    if (!videoRef.current) return;
    videoRef.current.playbackRate = appliedEdit.playback_speed || 1;
    videoRef.current.muted = appliedEdit.mute;
    const trim = appliedEdit.trim;
    if (!trim) return;
    if (videoRef.current.currentTime < trim.start) videoRef.current.currentTime = trim.start;
    if (videoRef.current.currentTime >= trim.end) videoRef.current.pause();
  };

  const handleVideoEnded = () => {
    const video = videoRef.current;
    if (!video || assetStack?.kind !== "live_photo" || assetStack.effect !== "bounce") return;
    const reverse = () => {
      if (!videoRef.current) return;
      if (videoRef.current.currentTime <= .04) {
        videoRef.current.currentTime = 0;
        void videoRef.current.play();
        return;
      }
      videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - .04);
      bounceFrameRef.current = window.requestAnimationFrame(reverse);
    };
    reverse();
  };

  if (isImage) return <GlobalImageEditor
    sourceKey={`${item.id}:${activeEdit?.id ?? "original"}`}
    name={item.display_name}
    url={contentUrl}
    indexLabel={`${index + 1} of ${items.length}`}
    tags={item.tags}
    initialEdit={editDraft}
    outputMimeType={mimeType === "image/jpeg" ? "image/jpeg" : mimeType === "image/webp" ? "image/webp" : "image/png"}
    loading={contentLoading || editVersionsLoading}
    error={contentError || undefined}
    readonly={!canEdit}
    onClose={onClose}
    onCancel={onClose}
    onSave={async (definition) => { await saveEdit(definition); }}
    onSaveAsCopy={async (definition) => { await saveAsCopy(definition); }}
    onSaveTags={async (nextTags) => { await onUpdate(item, { tags: nextTags }); }}
  />;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="grid h-[min(860px,calc(100dvh-32px))] min-h-0 w-[min(1320px,calc(100vw-32px))] max-w-none grid-cols-[minmax(0,1fr)_minmax(300px,340px)] grid-rows-[56px_minmax(0,1fr)] gap-0 overflow-hidden rounded-xl border-border/80 bg-background p-0 shadow-lg sm:max-w-none [&>button]:hidden"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusRef.current?.focus();
        }}
        onKeyDown={(event) => {
        const target = event.target as HTMLElement | null;
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c" && !target?.matches("input, textarea, select, [contenteditable='true']")) {
          event.preventDefault();
          void copyCurrentItem();
          return;
        }
      }}>
        <header className="relative z-20 col-span-2 flex min-w-0 items-center justify-between gap-4 border-b border-border/60 bg-background px-4">
          <div className="min-w-0"><DialogTitle className="truncate text-sm font-medium">{item.display_name}</DialogTitle><DialogDescription className="sr-only">Preview and edit {item.display_name}.</DialogDescription><p className="m-0 mt-0.5 text-[10px] text-muted-foreground">{index + 1} of {items.length}</p></div>
          <div className="flex min-w-0 shrink-0 items-center gap-1 overflow-x-auto py-1">
            {canEdit && assetStack && stackMediaID !== assetStack.cover_item_id && stackMediaMember?.role !== "motion" && stackMediaMember?.role !== "raw" ? <Button size="sm" variant="outline" type="button" onClick={() => void onSetStackCover(assetStack, stackMediaID)}>Make key photo</Button> : null}
            {canEdit && assetStack ? <Button size="sm" variant="outline" type="button" onClick={() => void onUngroupStack(assetStack)}>Ungroup</Button> : null}
            {canEdit && activeEdit ? <Button size="sm" variant="outline" type="button" onClick={() => onCopyEdit(normalizeLibraryEdit(activeEdit.edit_definition))}><Copy size={12}/>Copy edits</Button> : null}
            {canEdit ? <Button size="sm" variant="outline" type="button" disabled={editSaving} onClick={() => void saveAsCopy()}><Copy size={12}/>Save as copy</Button> : null}
            {canEdit && editing ? <Button size="sm" type="button" disabled={editSaving} onClick={() => void saveEdit()}>{editSaving ? "Saving…" : "Save"}</Button> : null}
            {canEdit ? <Button size="icon" variant="outline" type="button" onClick={() => void onUpdate(item, { favorite: !item.favorite })} aria-label={item.favorite ? "Remove favorite" : "Favorite"} title={item.favorite ? "Remove favorite" : "Favorite"}><Star size={15} fill={item.favorite ? "currentColor" : "none"}/></Button> : null}
            {canEdit ? <Button size="icon" variant="outline" type="button" onClick={() => void onUpdate(item, { hidden: !item.hidden })} aria-label={item.hidden ? "Unhide" : "Hide"} title={item.hidden ? "Unhide" : "Hide"}><EyeOff size={15}/></Button> : null}
            {canEdit && editingAvailable ? <Button size="icon" variant="outline" type="button" onClick={beginEditing} aria-label="Edit" title="Edit"><SlidersHorizontal size={15}/></Button> : null}
            {canCopy ? <Button size="icon" variant="outline" type="button" disabled={Boolean(activeEdit) && !renditionReady} onClick={() => void copyCurrentItem()} aria-label={activeEdit ? renditionReady ? "Copy edited media" : "Edited media is rendering" : "Copy to clipboard"} title={activeEdit ? renditionReady ? "Copy edited media" : "Edited media is rendering" : "Copy to clipboard"}><ClipboardCopy size={15}/></Button> : null}
            {canEdit ? <Button size="icon" variant="outline" type="button" onClick={() => void onTrash(item)} aria-label="Move to Recently Deleted" title="Move to Recently Deleted"><Trash2 size={15}/></Button> : null}
            <DialogClose asChild><Button size="icon" variant="outline" type="button" aria-label="Close"><X size={15}/></Button></DialogClose>
          </div>
        </header>
        <div ref={mediaAreaRef} className="relative isolate min-h-0 min-w-0 overflow-hidden bg-black/35">
          <div className="absolute inset-6 flex min-h-0 min-w-0 items-center justify-center overflow-hidden">
            <EmbeddedUniversalPreview name={stackMediaItem?.display_name ?? stackMediaMember?.display_name ?? item.display_name} mimeType={stackMediaMIME} url={contentUrl} loading={contentLoading} error={contentError} imageRef={imageRef} videoRef={videoRef} mediaStyle={stackMediaID === item.id ? mediaStyle : undefined} autoPlay={assetStack?.kind === "live_photo"} loop={assetStack?.kind === "live_photo" && assetStack.effect === "loop"} onVideoEnded={handleVideoEnded} onVideoMetadata={handleVideoTime} onVideoTime={handleVideoTime} fallbackAction={canCopy && stackMediaItem ? <Button size="sm" variant="outline" type="button" onClick={() => void copyCurrentItem(stackMediaItem)}><ClipboardCopy size={14}/>Copy</Button> : undefined}/>
          </div>
          {assetStack ? <div className="absolute left-4 top-4 flex items-center gap-1 rounded-xl border border-white/10 bg-black/55 p-1 text-white backdrop-blur-sm">{assetStack.members.map((member, memberIndex) => <Button className={`rounded-lg border-0 px-2 py-1 text-[10px] font-medium ${member.item_id === stackMediaID ? "bg-white text-black" : "bg-transparent text-white/75 hover:bg-white/10"}`} type="button" key={member.item_id} onClick={() => setStackMemberID(member.item_id === item.id ? "" : member.item_id)}>{assetStack.kind === "live_photo" ? member.role === "motion" ? <><Play className="mr-1 inline" size={10}/>Motion</> : "Still" : assetStack.kind === "raw_pair" ? member.role === "raw" ? "RAW" : "Rendered" : memberIndex + 1}</Button>)}</div> : null}
          {canEdit && assetStack?.kind === "live_photo" ? <div className="absolute left-4 top-16 flex items-center gap-1 rounded-xl border border-white/10 bg-black/55 p-1 text-white backdrop-blur-sm">{(["still", "loop", "bounce", "long_exposure"] as const).map((effect) => <Button className={`rounded-lg border-0 px-2 py-1 text-[10px] font-medium ${assetStack.effect === effect ? "bg-white text-black" : "bg-transparent text-white/75 hover:bg-white/10"}`} type="button" key={effect} onClick={() => void onSetStackEffect(assetStack, effect)}>{effect === "long_exposure" ? "Long Exposure" : effect[0].toUpperCase() + effect.slice(1)}</Button>)}</div> : null}
          {items.length > 1 ? <>
            <Button className="absolute left-4 top-1/2 z-20 grid size-10 -translate-y-1/2 place-items-center rounded-full border border-white/10 bg-black/45 text-white disabled:opacity-20" type="button" disabled={index <= 0} onClick={() => index > 0 && onSelect(items[index - 1].id)} aria-label="Previous item"><ChevronLeft size={20}/></Button>
            <Button className="absolute right-4 top-1/2 z-20 grid size-10 -translate-y-1/2 place-items-center rounded-full border border-white/10 bg-black/45 text-white disabled:opacity-20" type="button" disabled={index < 0 || index >= items.length - 1} onClick={() => index >= 0 && index < items.length - 1 && onSelect(items[index + 1].id)} aria-label="Next item"><ChevronRight size={20}/></Button>
          </> : null}
        </div>
        <aside className="relative z-10 min-h-0 min-w-0 overflow-y-auto border-l border-border/60 bg-card p-5">
          {editing ? <section className="mb-6 border-b border-border/60 pb-5"><div className="flex items-center justify-between"><h3 className="m-0 text-sm">Edit</h3><Button size="sm" variant="outline" type="button" onClick={() => setEditDraft(defaultLibraryEdit())}>Reset</Button></div><div className="mt-4 flex flex-wrap gap-2"><Button size="sm" variant="outline" type="button" onClick={() => setEditDraft((current) => ({ ...current, rotation: ((current.rotation + 90) % 360) as LibraryEditDefinition["rotation"] }))}><RotateCw size={12}/>Rotate</Button><Button size="sm" variant="outline" type="button" onClick={() => setEditDraft((current) => ({ ...current, flip_horizontal: !current.flip_horizontal }))}>Flip H</Button><Button size="sm" variant="outline" type="button" onClick={() => setEditDraft((current) => ({ ...current, flip_vertical: !current.flip_vertical }))}>Flip V</Button><Button size="sm" variant="outline" type="button" onClick={() => setEditDraft((current) => ({ ...current, auto_enhance: !current.auto_enhance }))}>{editDraft.auto_enhance ? "Auto on" : "Auto"}</Button></div><label className="mt-4 grid gap-1.5 text-[10px] font-medium capitalize text-muted-foreground">Filter<LibrarySelect value={editDraft.filter} onChange={(value) => setEditDraft((current) => ({ ...current, filter: value as LibraryEditDefinition["filter"] }))} label="Filter" options={[["","None"],["vivid","Vivid"],["dramatic","Dramatic"],["warm","Warm"],["cool","Cool"],["mono","Mono"],["noir","Noir"]]}/></label><LibraryEditRange label="Brightness" value={editDraft.brightness} min={0} max={2} step={0.05} onChange={(value) => setEditDraft((current) => ({ ...current, brightness: value }))}/><LibraryEditRange label="Contrast" value={editDraft.contrast} min={0} max={2} step={0.05} onChange={(value) => setEditDraft((current) => ({ ...current, contrast: value }))}/><LibraryEditRange label="Saturation" value={editDraft.saturation} min={0} max={2} step={0.05} onChange={(value) => setEditDraft((current) => ({ ...current, saturation: value }))}/><LibraryEditRange label="Grayscale" value={editDraft.grayscale} min={0} max={1} step={0.05} onChange={(value) => setEditDraft((current) => ({ ...current, grayscale: value }))}/><LibraryAdvancedAdjustments draft={editDraft} onChange={setEditDraft}/>{isImage ? <div className="mt-4"><p className="m-0 text-[10px] font-medium capitalize text-muted-foreground">Crop &amp; Straighten</p><LibraryEditRange label="Straighten" value={editDraft.straighten} min={-45} max={45} step={0.5} onChange={(value) => setEditDraft((current) => ({ ...current, straighten: value }))}/><div className="mt-2 flex gap-1"><Button size="sm" variant="outline" type="button" onClick={() => setEditDraft((current) => ({ ...current, crop: undefined }))}>Original</Button><Button size="sm" variant="outline" type="button" onClick={() => setEditDraft((current) => ({ ...current, crop: { x: 0.125, y: 0, width: 0.75, height: 1 } }))}>Square</Button><Button size="sm" variant="outline" type="button" onClick={() => setEditDraft((current) => ({ ...current, crop: { x: 0, y: 0.125, width: 1, height: 0.75 } }))}>Wide</Button></div></div> : null}{isVideo ? <div className="mt-4 grid grid-cols-2 gap-2"><label className="grid gap-1 text-[10px] capitalize text-muted-foreground">Trim Start<Input type="number" min={0} step={0.1} value={editDraft.trim?.start ?? 0} onChange={(event) => setEditDraft((current) => ({ ...current, trim: { start: Number(event.target.value), end: current.trim?.end ?? Math.max(1, Number(metadata.duration ?? 1)) } }))}/></label><label className="grid gap-1 text-[10px] capitalize text-muted-foreground">Trim End<Input type="number" min={0.1} step={0.1} value={editDraft.trim?.end ?? Number(metadata.duration ?? 1)} onChange={(event) => setEditDraft((current) => ({ ...current, trim: { start: current.trim?.start ?? 0, end: Number(event.target.value) } }))}/></label><label className="grid gap-1 text-[10px] capitalize text-muted-foreground">Speed<LibrarySelect value={String(editDraft.playback_speed)} onChange={(value) => setEditDraft((current) => ({ ...current, playback_speed: Number(value) }))} label="Speed" options={[["0.5","0.5×"],["1","1×"],["1.5","1.5×"],["2","2×"]]}/></label><Button className="self-end" size="sm" variant="outline" type="button" onClick={() => setEditDraft((current) => ({ ...current, mute: !current.mute }))}>{editDraft.mute ? "Muted" : "Mute"}</Button></div> : null}{editError ? <p className="mb-0 mt-3 text-xs text-red-200">{editError}</p> : null}<div className="mt-4 flex gap-2"><Button className="flex-1" size="sm" variant="outline" type="button" disabled={editSaving} onClick={() => { setEditing(false); setEditDraft(normalizeLibraryEdit(activeEdit?.edit_definition)); }}>Cancel</Button><Button className="flex-1" size="sm" type="button" disabled={editSaving} onClick={() => void saveEdit()}>{editSaving ? "Saving…" : "Save edit"}</Button></div></section> : null}
          {canEdit ? <form onSubmit={(event) => void saveMetadata(event)}>
            <label className="grid gap-1.5 text-[10px] font-medium capitalize text-muted-foreground">Name<Input value={displayName} maxLength={255} onChange={(event) => setDisplayName(event.target.value)}/></label>
            <label className="mt-4 grid gap-1.5 text-[10px] font-medium capitalize text-muted-foreground">Caption<Textarea className="min-h-24 resize-y" value={caption} maxLength={4000} onChange={(event) => setCaption(event.target.value)}/></label>
            <label className="mt-4 grid gap-1.5 text-[10px] font-medium capitalize text-muted-foreground">Tags<Input value={tags} placeholder="project, receipt, reference" onChange={(event) => setTags(event.target.value)}/></label>
            <Button className="mt-4 w-full" size="sm" type="submit" disabled={saving || !displayName.trim()}>{saving ? "Saving…" : "Save metadata"}</Button>
          </form> : <dl className="m-0 grid gap-3 text-xs"><LibraryMetadataRow label="Name" value={item.display_name}/><LibraryMetadataRow label="Caption" value={item.caption}/><LibraryMetadataRow label="Tags" value={item.tags.join(", ")}/></dl>}
          <dl className="mt-6 grid gap-3 border-t border-border/60 pt-5 text-xs">
            <LibraryMetadataRow label="Type" value={mimeType}/>
            <LibraryMetadataRow label="Size" value={formatBytes(Number(metadata.byte_size ?? 0))}/>
            <LibraryMetadataRow label="Added" value={formatTime(item.added_at)}/>
            <LibraryMetadataRow label="Uploaded" value={formatTime(item.file.original_uploaded_at)}/>
            {metadata.capture_timestamp ? <LibraryMetadataRow label="Captured" value={formatTime(String(metadata.capture_timestamp))}/> : null}
            {metadata.width && metadata.height ? <LibraryMetadataRow label="Dimensions" value={`${metadata.width} × ${metadata.height}`}/> : null}
            {metadata.duration ? <LibraryMetadataRow label="Duration" value={`${Number(metadata.duration).toFixed(2)} s`}/> : null}
            {Array.isArray(metadata.codecs) ? <LibraryMetadataRow label="Codecs" value={metadata.codecs.join(", ")}/> : null}
            {metadata.frame_rate ? <LibraryMetadataRow label="Frame rate" value={`${Number(metadata.frame_rate).toFixed(2)} fps`}/> : null}
            <LibraryMetadataRow label="Original name" value={item.file.original_filename}/>
            {item.date_override ? <LibraryMetadataRow label="Adjusted date" value={formatTime(item.date_override)}/> : null}
            {item.location_override && Object.keys(item.location_override).length > 0 ? <LibraryMetadataRow label="Location" value={JSON.stringify(item.location_override)}/> : null}
          </dl>
          {editingAvailable ? <section className="mt-6 border-t border-border/60 pt-5">
            <div className="flex items-center justify-between"><h3 className="m-0 text-sm">Versions</h3>{canEdit ? <Button className={!activeEdit ? "text-foreground" : undefined} size="sm" variant="outline" type="button" disabled={editSaving || !activeEdit} onClick={() => void selectEdit()}>Original</Button> : !activeEdit ? <span className="text-[10px] text-muted-foreground">Original selected</span> : null}</div>
            {editError && !editing ? <p className="mb-0 mt-3 text-xs text-red-200">{editError}</p> : null}
            <div className="mt-3 grid gap-1">{editVersions.map((version) => <div className={`flex items-center gap-2 rounded-lg bg-muted/40 px-2 py-2 ${version.is_current ? "ring-1 ring-primary" : ""}`} key={version.id}>
              <Button className="min-w-0 flex-1 border-0 bg-transparent p-0 text-left" type="button" disabled={!canEdit || editSaving || version.is_current} onClick={() => void selectEdit(version.id)}><span className="block text-xs font-medium">Edit {version.version_number}{version.is_current ? " · Current" : ""}</span><span className="mt-0.5 block text-[10px] text-muted-foreground">{libraryRenditionStatus(version)} · {formatTime(version.created_at)}</span></Button>
              {canEdit && (version.rendition_state === "none" || version.rendition_state === "failed") ? <Button size="sm" variant="outline" type="button" disabled={editSaving} onClick={() => void renderEdit(version.id)}>Render</Button> : null}
              {canEdit && !version.is_current ? <Button className="grid size-6 place-items-center border-0 bg-transparent text-muted-foreground" type="button" disabled={editSaving} onClick={() => void deleteEdit(version.id)} aria-label={`Delete edit ${version.version_number}`}><Trash2 size={12}/></Button> : null}
            </div>)}</div>
          </section> : null}
        </aside>
      </DialogContent>
    </Dialog>
  );
}
