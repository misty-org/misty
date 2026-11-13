import { desktopOs } from "./desktopOs";
import { hasTauriInternals } from "./tauri";

/**
 * Files dragged onto Misty from Finder, Explorer or a Linux file manager.
 *
 * The desktop webview hands an operating-system drop to Tauri, not to the page, so a plain HTML
 * `drop` never sees those files. Here one listener on Tauri's drag-drop event works out which
 * registered zone is under the pointer, lights it while files hover, and on drop reads the files
 * back through `dropped_file_read`, which only reads paths the system itself just dropped.
 */
export interface FileDropZone {
  element: HTMLElement;
  /** Whether the zone takes files right now; a disabled zone is passed over. */
  enabled(): boolean;
  hover(over: boolean): void;
  drop(files: File[]): void;
  error?(message: string): void;
}

const zones = new Set<FileDropZone>();
let listening: Promise<() => void> | null = null;
let hovered: FileDropZone | null = null;

const mimeTypes: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  html: "text/html",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
};

/** A file's type from its name, as a browser would give it for a picked file. */
export function mimeTypeForName(name: string): string {
  const ending = name.split(".").pop()?.toLowerCase() ?? "";
  return mimeTypes[ending] ?? "";
}

/** A path's last part, with either kind of slash. */
export function fileNameOf(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/**
 * Turns a drop position into page coordinates. macOS and Linux report it in the window's points,
 * Windows in its pixels; dividing by the window's size in the same unit and multiplying by the
 * page's size also takes the app's zoom into account.
 */
export function pagePoint(
  position: { x: number; y: number },
  window: { innerWidth: number; innerHeight: number },
  reported: { width: number; height: number },
): { x: number; y: number } {
  if (!reported.width || !reported.height) return position;
  return {
    x: (position.x * window.innerWidth) / reported.width,
    y: (position.y * window.innerHeight) / reported.height,
  };
}

/** The registered zone under a page point: the innermost one holding what's drawn there. */
export function zoneAt(point: { x: number; y: number }): FileDropZone | null {
  const hit = document.elementFromPoint(point.x, point.y);
  if (!hit) return null;
  let found: FileDropZone | null = null;
  for (const zone of zones) {
    if (!zone.enabled() || !zone.element.isConnected || !zone.element.contains(hit)) continue;
    if (!found || found.element.contains(zone.element)) found = zone;
  }
  return found;
}

function hover(zone: FileDropZone | null) {
  if (zone === hovered) return;
  hovered?.hover(false);
  hovered = zone;
  zone?.hover(true);
}

async function readDropped(paths: string[]): Promise<{ files: File[]; failed: string[] }> {
  const { invoke } = await import("@tauri-apps/api/core");
  const files: File[] = [];
  const failed: string[] = [];
  for (const path of paths) {
    const name = fileNameOf(path);
    try {
      const bytes = await invoke<ArrayBuffer>("dropped_file_read", { path });
      files.push(new File([bytes], name, { type: mimeTypeForName(name) }));
    } catch (error) {
      failed.push(typeof error === "string" ? error : `Misty couldn't read ${name}.`);
    }
  }
  return { files, failed };
}

async function listen(): Promise<() => void> {
  const { getCurrentWebview } = await import("@tauri-apps/api/webview");
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const webview = getCurrentWebview();
  const appWindow = getCurrentWindow();
  const inPixels = desktopOs() === "windows";
  const locate = async (position: { x: number; y: number }) => {
    const size = await appWindow.innerSize();
    const scale = inPixels ? 1 : await appWindow.scaleFactor();
    return zoneAt(
      pagePoint(position, window, { width: size.width / scale, height: size.height / scale }),
    );
  };
  return webview.onDragDropEvent(async ({ payload }) => {
    if (payload.type === "leave") return hover(null);
    const zone = await locate(payload.position);
    if (payload.type !== "drop") return hover(zone);
    hover(null);
    if (!zone || !payload.paths.length) return;
    const { files, failed } = await readDropped(payload.paths);
    if (failed.length) zone.error?.(failed[0]!);
    if (files.length) zone.drop(files);
  });
}

/** Adds a zone that takes dropped files; the returned function takes it away again. */
export function registerFileDropZone(zone: FileDropZone): () => void {
  zones.add(zone);
  if (!listening && hasTauriInternals()) {
    listening = listen().catch(() => {
      listening = null;
      return () => undefined;
    });
  }
  return () => {
    zones.delete(zone);
    if (hovered === zone) hover(null);
  };
}
