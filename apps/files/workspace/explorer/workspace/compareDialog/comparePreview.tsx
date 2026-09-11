import { explorerPreviewItem } from "@/features/files/native";
import type {
  CompareImagePreview,
  CompareImageState,
  CompareTextDiffState,
} from "../../model/interfaces/workspace/ExplorerCompareDialog";
import { buildCompareTextDiff } from "./compareDiff";

export async function loadCompareTextDiff(
  leftPath: string,
  rightPath: string,
): Promise<CompareTextDiffState | null> {
  try {
    const [leftText, rightText] = await Promise.all([
      previewTextForCompare(leftPath),
      previewTextForCompare(rightPath),
    ]);
    if (leftText == null || rightText == null) return null;
    return buildCompareTextDiff(leftText, rightText);
  } catch {
    return null;
  }
}

export async function loadCompareImagePreview(
  leftPath: string,
  rightPath: string,
): Promise<CompareImageState | null> {
  try {
    const [left, right] = await Promise.all([
      previewImageForCompare(leftPath),
      previewImageForCompare(rightPath),
    ]);
    if (!left || !right) return null;
    return { left, right };
  } catch {
    return null;
  }
}

export async function previewTextForCompare(
  path: string,
): Promise<string | null> {
  const payload = await explorerPreviewItem(path);
  if (!comparePreviewIsText(payload.mimeType)) return null;
  return new TextDecoder("utf-8").decode(Uint8Array.from(payload.bytes));
}

export async function previewImageForCompare(
  path: string,
): Promise<CompareImagePreview | null> {
  const payload = await explorerPreviewItem(path);
  if (!payload.mimeType.toLowerCase().startsWith("image/")) return null;
  return {
    src: `data:${payload.mimeType};base64,${base64FromBytes(payload.bytes)}`,
    mimeType: payload.mimeType,
    byteLength: payload.bytes.length,
  };
}

export function comparePreviewIsText(mimeType: string): boolean {
  const normalized = mimeType.toLowerCase();
  return (
    normalized.startsWith("text/") ||
    normalized.includes("json") ||
    normalized.includes("xml") ||
    normalized.includes("javascript") ||
    normalized.includes("typescript")
  );
}

export function base64FromBytes(bytes: number[]): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.slice(index, index + 0x8000));
  }
  return window.btoa(binary);
}

export {
  CompareDiffLine,
  parentPath,
  joinLocalPath,
} from "./comparePresentation";
