import type {
  ExcalidrawElement,
  OrderedExcalidrawElement,
} from "@excalidraw/excalidraw/element/types";
import type { BinaryFileData, BinaryFiles } from "@excalidraw/excalidraw/types";
import type * as Y from "yjs";
import { readToolDoc, withToolDoc } from "../../collab/toolSession";
import { exportFilename, saveExportFile } from "../notes/export/saveExport";
import { drawingsApi } from "./api/api";
import { localDrawingOrigin, readDrawingElements } from "./collaboration/drawingSceneStore";
import { hydrateDrawingBinaryFile, uploadDrawingBinaryFile } from "./drawingAssets";
import { notifyDrawingListChanged } from "./drawingEvents";
import type { DrawingAssetReference, SpaceDrawing } from "./drawingTypes";

/*
 * `.excalidraw` files (plan W3): Excalidraw's own JSON scene, the format excalidraw.com and its
 * editors open and save. Export writes the board with its images inlined; import makes a new
 * whiteboard from a file, its images uploaded as the board's assets.
 */

export const excalidrawFileExtension = "excalidraw";
export const excalidrawMimeType = "application/vnd.excalidraw+json";

/** The file's JSON shape. */
export interface ExcalidrawFileData {
  type: "excalidraw";
  version: 2;
  source: string;
  elements: ExcalidrawElement[];
  appState: { viewBackgroundColor: string; gridSize: null };
  files: BinaryFiles;
}

/** A scene as a `.excalidraw` file's text. Deleted elements are left out. */
export function serializeExcalidrawFile(input: {
  elements: readonly ExcalidrawElement[];
  viewBackgroundColor?: string;
  files?: BinaryFiles;
}): string {
  const elements = input.elements.filter((element) => !element.isDeleted);
  const used = new Set(
    elements.flatMap((element) =>
      element.type === "image" && element.fileId ? [element.fileId] : [],
    ),
  );
  const files = Object.fromEntries(
    Object.entries(input.files ?? {}).filter(([id]) => used.has(id as never)),
  ) as BinaryFiles;
  const data: ExcalidrawFileData = {
    type: "excalidraw",
    version: 2,
    source: "https://misty.app",
    elements: [...elements],
    appState: { viewBackgroundColor: input.viewBackgroundColor ?? "#ffffff", gridSize: null },
    files,
  };
  return JSON.stringify(data, null, 2);
}

/** Why a file isn't a scene that can be imported. */
export class ExcalidrawFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExcalidrawFileError";
  }
}

/** Reads a `.excalidraw` file's text, checking it is a scene. */
export function parseExcalidrawFile(text: string): {
  elements: ExcalidrawElement[];
  viewBackgroundColor?: string;
  files: BinaryFiles;
} {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ExcalidrawFileError("This file isn't an Excalidraw scene.");
  }
  if (!data || typeof data !== "object")
    throw new ExcalidrawFileError("This file isn't an Excalidraw scene.");
  const scene = data as Partial<ExcalidrawFileData> & { type?: unknown };
  if (scene.type !== "excalidraw" || !Array.isArray(scene.elements)) {
    throw new ExcalidrawFileError(
      (data as { type?: unknown }).type === "excalidrawlib"
        ? "This is an Excalidraw library, not a scene."
        : "This file isn't an Excalidraw scene.",
    );
  }
  const elements = scene.elements.filter(
    (element): element is ExcalidrawElement =>
      Boolean(element) &&
      typeof element === "object" &&
      typeof (element as ExcalidrawElement).id === "string" &&
      typeof (element as ExcalidrawElement).type === "string" &&
      !(element as ExcalidrawElement).isDeleted,
  );
  const files =
    scene.files && typeof scene.files === "object" && !Array.isArray(scene.files)
      ? (Object.fromEntries(
          Object.entries(scene.files).filter(
            ([, file]) =>
              file &&
              typeof file === "object" &&
              typeof (file as BinaryFileData).dataURL === "string" &&
              typeof (file as BinaryFileData).mimeType === "string",
          ),
        ) as BinaryFiles)
      : ({} as BinaryFiles);
  const background = scene.appState?.viewBackgroundColor;
  return {
    elements,
    files,
    ...(typeof background === "string" ? { viewBackgroundColor: background } : {}),
  };
}

/** A drawing room's scene as a `.excalidraw` file, its images read back from the Space. */
export async function drawingFileFromRoom(input: {
  spaceId: string;
  drawingId: string;
  elements: Y.Map<OrderedExcalidrawElement>;
  scene: Y.Map<unknown>;
  files: Y.Map<DrawingAssetReference>;
}): Promise<string> {
  const elements = readDrawingElements(input.elements);
  const references = [...input.files.values()];
  const hydrated = await Promise.allSettled(
    references.map(async (reference) => {
      const file = await hydrateDrawingBinaryFile(input.spaceId, input.drawingId, reference);
      return [file.id, file] as const;
    }),
  );
  const background = input.scene.get("viewBackgroundColor");
  return serializeExcalidrawFile({
    elements,
    viewBackgroundColor: typeof background === "string" ? background : undefined,
    files: Object.fromEntries(
      hydrated.flatMap((result) => (result.status === "fulfilled" ? [result.value] : [])),
    ) as BinaryFiles,
  });
}

/** Saves a whiteboard as a `.excalidraw` file. */
export async function exportDrawingFile(
  spaceId: string,
  drawingId: string,
  title: string,
): Promise<void> {
  const text = await readToolDoc("drawing", spaceId, drawingId, (doc) =>
    drawingFileFromRoom({
      spaceId,
      drawingId,
      elements: doc.getMap("drawing:elements"),
      scene: doc.getMap("drawing:scene"),
      files: doc.getMap("drawing:files"),
    }),
  );
  saveExportFile(
    new Blob([text], { type: excalidrawMimeType }),
    exportFilename(title, excalidrawFileExtension, "Untitled whiteboard"),
  );
}

/** Whether a file looks like a `.excalidraw` scene, by its name or type. */
export function isExcalidrawFile(file: Pick<File, "name" | "type">): boolean {
  return /\.excalidraw(\.json)?$/i.test(file.name) || file.type === excalidrawMimeType;
}

/**
 * Makes a new whiteboard in the Space from a `.excalidraw` file: the scene goes into the new
 * board's room at once, and its images become the board's assets. Returns the new whiteboard.
 */
export async function importExcalidrawFile(
  spaceId: string,
  file: File,
  title?: string,
): Promise<SpaceDrawing> {
  const parsed = parseExcalidrawFile(await file.text());
  const { restoreElements } = await import("@excalidraw/excalidraw");
  const elements = restoreElements(parsed.elements, null, { repairBindings: true });
  const name =
    title?.trim() ||
    file.name.replace(/\.excalidraw(\.json)?$/i, "").trim() ||
    "Untitled whiteboard";
  const drawing = await drawingsApi.create(spaceId, name);
  await withToolDoc("drawing", spaceId, drawing.id, async (doc) => {
    const used = new Set(
      elements.flatMap((element) =>
        element.type === "image" && element.fileId ? [element.fileId] : [],
      ),
    );
    const uploads = await Promise.allSettled(
      Object.values(parsed.files)
        .filter((binary) => used.has(binary.id))
        .map((binary) => uploadDrawingBinaryFile(spaceId, drawing.id, binary)),
    );
    const sceneElements = doc.getMap<OrderedExcalidrawElement>("drawing:elements");
    const files = doc.getMap<DrawingAssetReference>("drawing:files");
    const scene = doc.getMap<unknown>("drawing:scene");
    doc.transact(() => {
      for (const element of elements)
        sceneElements.set(element.id, JSON.parse(JSON.stringify(element)));
      for (const upload of uploads)
        if (upload.status === "fulfilled") files.set(upload.value.fileId, upload.value);
      if (parsed.viewBackgroundColor) scene.set("viewBackgroundColor", parsed.viewBackgroundColor);
    }, localDrawingOrigin);
  });
  notifyDrawingListChanged(spaceId);
  return drawing;
}
