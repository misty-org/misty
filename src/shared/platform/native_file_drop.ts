import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { invoke } from "@tauri-apps/api/core";
import type { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { desktopOs } from "./desktop_os";
import { hasTauriInternals } from "./tauri";

interface FileDropZone {
  element: HTMLElement;
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

function mimeTypeForName(name: string): string {
  const ending = name.split(".").pop()?.toLowerCase() ?? "";
  return mimeTypes[ending] ?? "";
}

function fileNameOf(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function pagePoint(
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

function zoneAt(point: { x: number; y: number }): FileDropZone | null {
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

async function readOne(invoke: typeof tauriInvoke, path: string): Promise<ArrayBuffer> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await invoke<ArrayBuffer>("dropped_file_read", { path });
    } catch (error) {
      const early = typeof error === "string" && error.includes("wasn't dropped");
      if (!early || attempt >= 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
}

export async function readDropped(paths: string[]): Promise<{ files: File[]; failed: string[] }> {
  const files: File[] = [];
  const failed: string[] = [];
  for (const path of paths) {
    const name = fileNameOf(path);
    try {
      const bytes = await readOne(invoke, path);
      files.push(new File([bytes], name, { type: mimeTypeForName(name) }));
    } catch (error) {
      failed.push(typeof error === "string" ? error : `Misty couldn't read ${name}.`);
    }
  }
  return { files, failed };
}

async function listen(): Promise<() => void> {
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
