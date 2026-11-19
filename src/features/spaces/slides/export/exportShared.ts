import type * as Y from "yjs";
import { readDeckSnapshot, type DeckSnapshot } from "../deck/snapshot";
import { loadThemeFonts } from "../deck/themeFonts";
import { deckTheme, exportColors, type DeckTheme, type ThemeColors } from "../deck/themes";
import type { LiveEmbedRef } from "../deck/types";
import { deckAssetUrl } from "../render/renderHooks";

/** What both exports need: the deck's slides, its theme and its colors as hex. */
export interface DeckExportInput {
  doc: Y.Doc;
  spaceId: string;
  deckId: string;
  /** The deck's title, as the server has it. */
  title: string;
}

export interface PreparedDeck {
  snapshot: DeckSnapshot;
  theme: DeckTheme;
  colors: ThemeColors;
}

export async function prepareDeck(input: DeckExportInput): Promise<PreparedDeck> {
  const snapshot = readDeckSnapshot(input.doc);
  const theme = deckTheme(snapshot.theme);
  await loadThemeFonts(theme);
  return { snapshot, theme, colors: exportColors(theme) };
}

/** A file name from the deck's title, safe on every system. */
export function deckFilename(title: string, extension: string): string {
  const base =
    title
      .trim()
      .replace(/[\\/:*?"<>|\p{Cc}]+/gu, " ")
      .replace(/\s+/g, " ")
      .slice(0, 120)
      .trim() || "Untitled deck";
  return `${base}.${extension}`;
}

/** Saves a file the way the app saves its other exports: the webview's own download. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The image couldn't be read."));
    image.src = src;
  });
}

/**
 * Draws `image` into a `w`×`h` canvas the way the slot shows it: covering the box, cropped
 * around its focal point.
 */
export function drawCover(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource & { width: number; height: number },
  box: { x: number; y: number; w: number; h: number },
  focal: { x: number; y: number },
): void {
  const scale = Math.max(box.w / image.width, box.h / image.height);
  const width = box.w / scale;
  const height = box.h / scale;
  const sx = Math.min(Math.max(0, image.width * focal.x - width / 2), image.width - width);
  const sy = Math.min(Math.max(0, image.height * focal.y - height / 2), image.height - height);
  context.drawImage(image, sx, sy, width, height, box.x, box.y, box.w, box.h);
}

/** A deck image cropped to its slot, as a PNG data URL at up to `pixels` wide. */
export async function croppedImage(
  input: Pick<DeckExportInput, "spaceId" | "deckId">,
  assetId: string,
  box: { w: number; h: number },
  focal: { x: number; y: number },
  pixels = 1920,
): Promise<string | null> {
  try {
    const image = await loadImage(await deckAssetUrl(input.spaceId, input.deckId, assetId));
    const ratio = Math.min(1, pixels / box.w);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(box.w * Math.max(ratio, 0.5)));
    canvas.height = Math.max(1, Math.round((canvas.width * box.h) / box.w));
    const context = canvas.getContext("2d");
    if (!context) return null;
    drawCover(context, image, { x: 0, y: 0, w: canvas.width, h: canvas.height }, focal);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

/** A chart's data as the Data feature hands it to its PowerPoint exporter. */
export interface ExportChartData {
  type: string;
  title: string;
  categories: string[];
  series: Array<{ name: string; values: Array<number | null> }>;
  display?: string;
  problem?: "removed" | "empty";
}

type DataModule = {
  readChartData?: (
    spaceId: string,
    workbookId: string,
    chartId: string,
  ) => Promise<ExportChartData>;
};

/** A Data chart's current values, or null when the chart can't be read. */
export async function loadChartData(
  spaceId: string,
  embed: LiveEmbedRef,
): Promise<ExportChartData | null> {
  try {
    const data = (await import("@/features/spaces/data")) as DataModule;
    if (!data.readChartData) return null;
    const chart = await data.readChartData(spaceId, embed.item_id, embed.part_id);
    return chart && !chart.problem ? chart : null;
  } catch {
    return null;
  }
}

/** A Whiteboard frame drawn to a PNG, or null when the board or frame can't be read. */
export async function boardFramePng(
  spaceId: string,
  embed: LiveEmbedRef,
  maxWidthOrHeight = 2400,
): Promise<Blob | null> {
  const [
    { acquireDrawingSession, releaseDrawingSession },
    { readDrawingElements },
    assets,
    frames,
  ] = await Promise.all([
    import("../../journal/drawings/collaboration/drawingCollaboration"),
    import("../../journal/drawings/collaboration/drawingSceneStore"),
    import("../../journal/drawings/drawingAssets"),
    import("../../journal/drawings/drawingFrames"),
  ]);
  let joined = false;
  try {
    const session = await acquireDrawingSession(spaceId, embed.item_id, { publishPresence: false });
    joined = true;
    if (!session.provider.synced) {
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error("timeout")), 15_000);
        const onSync = (synced: boolean) => {
          if (!synced) return;
          window.clearTimeout(timer);
          session.provider.off("sync", onSync);
          resolve();
        };
        session.provider.on("sync", onSync);
      });
    }
    const scene = frames.frameScene(readDrawingElements(session.elements), embed.part_id);
    if (!scene) return null;
    const used = new Set(
      scene.elements.flatMap((element) =>
        element.type === "image" && element.fileId ? [element.fileId as string] : [],
      ),
    );
    const hydrated = await Promise.allSettled(
      [...session.files.values()]
        .filter((reference) => used.has(reference.fileId))
        .map(async (reference) => {
          const file = await assets.hydrateDrawingBinaryFile(spaceId, embed.item_id, reference);
          return [file.id, file] as const;
        }),
    );
    const files = Object.fromEntries(
      hydrated.flatMap((result) => (result.status === "fulfilled" ? [result.value] : [])),
    );
    const background = session.scene.get("viewBackgroundColor");
    const { exportToBlob } = await import("@excalidraw/excalidraw");
    return await exportToBlob({
      elements: scene.elements,
      files: files as never,
      mimeType: "image/png",
      maxWidthOrHeight,
      exportPadding: 16,
      exportingFrame: scene.frame,
      appState: {
        exportBackground: true,
        viewBackgroundColor: typeof background === "string" ? background : "#ffffff",
      },
    });
  } catch {
    return null;
  } finally {
    if (joined) releaseDrawingSession(spaceId, embed.item_id, { publishPresence: false });
  }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("The file couldn't be read."));
    reader.readAsDataURL(blob);
  });
}
