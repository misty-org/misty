import { invoke } from "@tauri-apps/api/core";
import { hasTauriInternals } from "@/shared/platform/tauri";
import type { FootageLabel } from "./types";

/*
 * What is in a picture, from the computer's own image classifier (Apple's Vision, in native
 * code: `media/classify.rs`). Where the computer has none, scenes go without labels.
 */

/** Labels less sure than this are left out of a scene. */
const MIN_CONFIDENCE = 0.25;
/** The most labels one scene keeps. */
const MAX_LABELS = 6;

let supported: Promise<boolean> | null = null;

/** Whether this computer can say what is in a picture, asked once. */
export function canLabelPictures(): Promise<boolean> {
  if (!hasTauriInternals()) return Promise.resolve(false);
  supported ??= invoke<boolean>("image_classify_supported").catch(() => false);
  return supported;
}

/** The surest labels of a JPEG or PNG picture, or none when it can't be recognized. */
export async function labelPicture(picture: Uint8Array): Promise<FootageLabel[]> {
  try {
    const labels = await invoke<FootageLabel[]>("image_classify", picture);
    return labels
      .filter((each) => each.confidence >= MIN_CONFIDENCE)
      .slice(0, MAX_LABELS)
      .map((each) => ({ label: each.label, confidence: Math.round(each.confidence * 100) / 100 }));
  } catch {
    return [];
  }
}
