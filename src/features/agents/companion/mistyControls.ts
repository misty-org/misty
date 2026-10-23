import { getAppliedAppRenderScale } from "@/shared/hooks/useAppZoom";
import { hasTauriInternals } from "@/shared/platform/tauri";
import type { DisplayCapture, ScreenControl } from "./protocol";

/**
 * Misty's own controls, read from its interface when the companion captures
 * the screens. The model gets each control's exact name and position instead
 * of guessing what an icon means from pixels.
 */

const controlSelector = [
  "button",
  "a[href]",
  "input:not([type=hidden])",
  "select",
  "textarea",
  ...[
    "button",
    "link",
    "tab",
    "menuitem",
    "menuitemcheckbox",
    "menuitemradio",
    "option",
    "switch",
    "checkbox",
    "radio",
    "combobox",
    "treeitem",
    "slider",
  ].map((role) => `[role="${role}"]`),
].join(",");

/** Enough for the shell, an open menu and a page of settings rows. */
const maxScreenControls = 150;
const maxLabelLength = 80;

/** Where the main webview's CSS pixels land in display units (CG points on macOS, physical pixels on Windows). */
interface WebviewFrame {
  x: number;
  y: number;
  /** Display units per CSS pixel. */
  unit: number;
}

interface FoundControl {
  label: string;
  role: string;
  /** Rendered but transparent until the pointer comes near, like a pane's corner tray. */
  hover?: boolean;
  rect: { left: number; top: number; width: number; height: number };
}

/** Attach the visible Misty controls to the captures they appear on. Never fails a capture. */
export async function withMistyControls(captures: DisplayCapture[]): Promise<DisplayCapture[]> {
  if (!captures.length || !hasTauriInternals()) return captures;
  try {
    const frame = await focusedWebviewFrame();
    if (!frame) return captures;
    return placeControls(findControls(document), frame, captures);
  } catch {
    return captures;
  }
}

/** Only while a Misty window is in front: another app could cover a background one. */
async function focusedWebviewFrame(): Promise<WebviewFrame | undefined> {
  if (document.visibilityState !== "visible") return undefined;
  const [{ getCurrentWindow }, { platform }] = await Promise.all([
    import("@tauri-apps/api/window"),
    import("@tauri-apps/plugin-os"),
  ]);
  const win = getCurrentWindow();
  const [focused, minimized, origin, factor] = await Promise.all([
    win.isFocused(),
    win.isMinimized(),
    win.innerPosition(),
    win.scaleFactor(),
  ]);
  if (!focused || minimized || !(factor > 0)) return undefined;
  const zoom = getAppliedAppRenderScale();
  return platform() === "macos"
    ? { x: origin.x / factor, y: origin.y / factor, unit: zoom }
    : { x: origin.x, y: origin.y, unit: zoom * factor };
}

export function findControls(root: Document): FoundControl[] {
  const view = root.defaultView;
  const width = view?.innerWidth ?? 0;
  const height = view?.innerHeight ?? 0;
  const found: FoundControl[] = [];
  for (const element of Array.from(root.querySelectorAll<HTMLElement>(controlSelector))) {
    if (found.length >= maxScreenControls) break;
    if (element.closest('[aria-hidden="true"],[inert],[hidden]')) continue;
    if ((element as HTMLButtonElement).disabled) continue;
    if (typeof element.checkVisibility === "function" && !element.checkVisibility()) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) continue;
    if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= width || rect.top >= height) continue;
    const label = controlLabel(element);
    if (!label) continue;
    // checkVisibility ignores opacity unless asked; a transparent control is on
    // the page but the user cannot see it until they hover where it sits.
    const hover =
      typeof element.checkVisibility === "function" &&
      !element.checkVisibility({ opacityProperty: true });
    found.push({
      label,
      role: controlRole(element),
      ...(hover ? { hover } : {}),
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    });
  }
  return found;
}

function controlLabel(element: HTMLElement) {
  // A private tab's title stays on this device.
  if (element.querySelector('[aria-label="Private tab"]')) return "Private tab";
  const labelledBy = element
    .getAttribute("aria-labelledby")
    ?.split(/\s+/)
    .map((id) => element.ownerDocument.getElementById(id)?.textContent ?? "")
    .join(" ");
  const raw =
    element.getAttribute("aria-label") ||
    labelledBy ||
    element.getAttribute("title") ||
    (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
      ? element.placeholder
      : element.textContent) ||
    "";
  const label = raw.replace(/\s+/g, " ").trim();
  return label.length > maxLabelLength ? `${label.slice(0, maxLabelLength - 1)}…` : label;
}

function controlRole(element: HTMLElement) {
  const role = element.getAttribute("role");
  if (role) return role;
  switch (element.tagName) {
    case "A":
      return "link";
    case "SELECT":
      return "combobox";
    case "TEXTAREA":
      return "textbox";
    case "INPUT": {
      const type = (element as HTMLInputElement).type;
      return type === "checkbox" || type === "radio" ? type : "textbox";
    }
    default:
      return "button";
  }
}

/** Convert CSS rects to each capture's pixels; a control belongs to the screen holding its center. */
export function placeControls(
  controls: FoundControl[],
  frame: WebviewFrame,
  captures: DisplayCapture[],
): DisplayCapture[] {
  const placed = new Map<string, ScreenControl[]>();
  for (const control of controls) {
    const left = frame.x + control.rect.left * frame.unit;
    const top = frame.y + control.rect.top * frame.unit;
    const width = control.rect.width * frame.unit;
    const height = control.rect.height * frame.unit;
    const cx = left + width / 2;
    const cy = top + height / 2;
    const capture = captures.find(({ display: d }) => {
      return cx >= d.x && cx < d.x + d.width && cy >= d.y && cy < d.y + d.height;
    });
    if (!capture || !(capture.width > 0) || !(capture.height > 0)) continue;
    const sx = capture.width / capture.display.width;
    const sy = capture.height / capture.display.height;
    const list = placed.get(capture.screen) ?? [];
    list.push({
      label: control.label,
      role: control.role,
      x: Math.round((cx - capture.display.x) * sx),
      y: Math.round((cy - capture.display.y) * sy),
      width: Math.max(1, Math.round(width * sx)),
      height: Math.max(1, Math.round(height * sy)),
      ...(control.hover ? { reveal: "hover" as const } : {}),
    });
    placed.set(capture.screen, list);
  }
  return captures.map((capture) =>
    placed.has(capture.screen) ? { ...capture, controls: placed.get(capture.screen) } : capture,
  );
}
