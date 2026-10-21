import { invoke } from "@tauri-apps/api/core";
import type { DisplayCapture, PresentedFocus } from "./protocol";

type RegionCapture = {
  mimeType: string;
  dataUrl: string;
  width: number;
  height: number;
  region: { x: number; y: number; width: number; height: number };
  displayId: number;
};

const MIN_REGION = 64;
const MAX_REGION = 1200;
const MARGIN = 40;

async function sha256(dataUrl: string): Promise<string> {
  const bytes = Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(",") + 1)), (c) =>
    c.charCodeAt(0),
  );
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * A lesson check's close-up (Teach mode): the region the step pointed the person
 * at, captured at full resolution and labelled focus1, so small code and text read
 * exactly. Its display frame is the region itself, so points and regions the model
 * places on it map back to the screen like any capture's.
 */
export async function focusCapture(
  turn: number,
  focus: PresentedFocus,
): Promise<DisplayCapture | undefined> {
  const { frame } = focus;
  const size = Math.min(
    MAX_REGION,
    Math.max(MIN_REGION, Math.max(frame.width, frame.height) + MARGIN * 2),
  );
  const crop = await invoke<RegionCapture>("cursor_companion_capture_region", {
    turn,
    displayId: focus.displayId,
    x: frame.x + frame.width / 2,
    y: frame.y + frame.height / 2,
    size,
  });
  if (!crop.width || !crop.height || !crop.region.width || !crop.region.height) return undefined;
  return {
    id: crypto.randomUUID(),
    name: `focus1 (${crop.width} × ${crop.height})`,
    mimeType: crop.mimeType as DisplayCapture["mimeType"],
    dataUrl: crop.dataUrl,
    width: crop.width,
    height: crop.height,
    contentHash: await sha256(crop.dataUrl),
    capturedAt: Date.now(),
    source: "focus-region",
    screen: "focus1",
    primary: false,
    display: { id: crop.displayId, ...crop.region, scale: 1 },
  };
}
