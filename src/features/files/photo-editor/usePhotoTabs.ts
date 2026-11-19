import { useRef, useState } from "react";
import type { CropRect } from "@/shared/ui";
import type { EditorMode } from "./editorTypes";
import {
  aspectRatio,
  cropToRatio,
  fullCrop,
  sameCrop,
  turnEdit,
  turnedSize,
  type AspectId,
  type ImageEdit,
} from "./imageEdit";
import { markingTabs, type PhotoTab } from "./PhotoEditorLayout";
import type { ImageDocument } from "./useImageDocument";

/**
 * The open tab in the rail and the crop it holds: the Crop tab puts a frame on the image, and
 * leaving it (another tab, its Crop button, Enter) keeps the frame; Escape leaves it as it was.
 * What the image is open for follows the tab: cropping, marking up (Markup, Text and Stickers),
 * or looking.
 */
export function usePhotoTabs(options: {
  edit: ImageEdit;
  change: ImageDocument["change"];
  natural: { width: number; height: number };
  readonly: boolean;
  /** Leaving the tabs that mark the image lets go of the picked marks. */
  onLeaveMarkup: () => void;
  /** Cropping and marking up show the edit, not the original. */
  onShowEdit: () => void;
}) {
  const { edit, change, natural } = options;
  const [tab, setTab] = useState<PhotoTab>("adjust");
  const previousTab = useRef<PhotoTab>("adjust");
  const [cropDraft, setCropDraft] = useState<CropRect | null>(null);
  const [cropAspect, setCropAspect] = useState<AspectId>("free");

  const mode: EditorMode = options.readonly
    ? "view"
    : tab === "crop" && cropDraft
      ? "crop"
      : markingTabs.includes(tab)
        ? "markup"
        : "view";
  const frame = turnedSize(natural.width, natural.height, edit.rotation);
  const cropRatio = aspectRatio(cropAspect, { crop: cropDraft ?? edit.crop }, frame);

  const keepCrop = () => {
    const crop = cropDraft;
    setCropDraft(null);
    if (crop && (!sameCrop(crop, edit.crop) || cropAspect !== edit.aspect))
      change((current) => ({ ...current, crop, aspect: cropAspect }));
  };
  const openTab = (to: PhotoTab) => {
    if (to === tab) return;
    if (tab === "crop") keepCrop();
    if (markingTabs.includes(tab) && !markingTabs.includes(to)) options.onLeaveMarkup();
    if (to === "crop") {
      options.onShowEdit();
      setCropDraft(edit.crop);
      setCropAspect(edit.aspect);
    }
    if (markingTabs.includes(to)) options.onShowEdit();
    previousTab.current = tab;
    setTab(to);
  };
  const leaveCrop = () => setTab(previousTab.current === "crop" ? "adjust" : previousTab.current);
  const applyCrop = () => {
    keepCrop();
    leaveCrop();
  };
  const cancelCrop = () => {
    setCropDraft(null);
    leaveCrop();
  };
  const resetCrop = () => {
    setCropAspect("free");
    setCropDraft(fullCrop);
  };
  const pickAspect = (aspect: AspectId) => {
    setCropAspect(aspect);
    const from = cropDraft ?? edit.crop;
    setCropDraft(cropToRatio(from, aspectRatio(aspect, { crop: from }, frame), frame));
  };
  /** Turns or mirrors the image; while cropping, the frame turns with it. */
  const reshape = (how: (current: ImageEdit) => ImageEdit) => {
    const draft = mode === "crop" ? cropDraft : null;
    change((current) => how(draft ? { ...current, crop: draft } : current));
    if (draft) setCropDraft(how({ ...edit, crop: draft }).crop);
  };
  const turn = (clockwise: boolean) => reshape((current) => turnEdit(current, clockwise));

  return {
    tab,
    mode,
    openTab,
    cropDraft,
    setCropDraft,
    cropAspect,
    cropRatio,
    cropChanged: Boolean(cropDraft && !sameCrop(cropDraft, fullCrop)),
    applyCrop,
    cancelCrop,
    resetCrop,
    pickAspect,
    reshape,
    turn,
  };
}
