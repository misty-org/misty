import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  withToolDoc: vi.fn(),
  upload: vi.fn(),
}));

vi.mock("./api/api", () => ({ drawingsApi: { create: mocks.create } }));
vi.mock("../../collab/toolSession", () => ({
  withToolDoc: mocks.withToolDoc,
  readToolDoc: vi.fn(),
}));
vi.mock("./drawingAssets", () => ({
  uploadDrawingBinaryFile: mocks.upload,
  hydrateDrawingBinaryFile: vi.fn(),
}));
vi.mock("@excalidraw/excalidraw", () => ({
  restoreElements: (elements: Array<Record<string, unknown>>) =>
    elements.map((element, index) => ({ ...element, index: `a${index}` })),
}));

import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import {
  ExcalidrawFileError,
  importExcalidrawFile,
  parseExcalidrawFile,
  serializeExcalidrawFile,
} from "./excalidrawFile";

const rectangle = {
  id: "rect_1",
  type: "rectangle",
  x: 10,
  y: 20,
  width: 100,
  height: 50,
  isDeleted: false,
} as unknown as ExcalidrawElement;
const image = {
  id: "img_1",
  type: "image",
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  fileId: "file_1",
  isDeleted: false,
} as unknown as ExcalidrawElement;
const removed = { ...rectangle, id: "gone", isDeleted: true } as unknown as ExcalidrawElement;
const file = {
  id: "file_1",
  mimeType: "image/png",
  dataURL: "data:image/png;base64,AAAA",
  created: 1,
};

describe(".excalidraw files", () => {
  beforeEach(() => {
    mocks.create.mockReset();
    mocks.withToolDoc.mockReset();
    mocks.upload.mockReset();
  });

  it("round-trips a scene, leaving deleted elements and unused files out", () => {
    const text = serializeExcalidrawFile({
      elements: [rectangle, image, removed],
      viewBackgroundColor: "#fafafa",
      files: { file_1: file, unused: { ...file, id: "unused" } } as never,
    });
    const data = JSON.parse(text);
    expect(data).toMatchObject({ type: "excalidraw", version: 2 });
    expect(Object.keys(data.files)).toEqual(["file_1"]);
    const parsed = parseExcalidrawFile(text);
    expect(parsed.elements.map((element) => element.id)).toEqual(["rect_1", "img_1"]);
    expect(parsed.viewBackgroundColor).toBe("#fafafa");
    expect(Object.keys(parsed.files)).toEqual(["file_1"]);
  });

  it("refuses files that aren't scenes", () => {
    expect(() => parseExcalidrawFile("not json")).toThrow(ExcalidrawFileError);
    expect(() => parseExcalidrawFile(JSON.stringify({ type: "excalidrawlib" }))).toThrow(
      "This is an Excalidraw library, not a scene.",
    );
    expect(() => parseExcalidrawFile(JSON.stringify({ type: "excalidraw" }))).toThrow(
      ExcalidrawFileError,
    );
  });

  it("imports a file into a new whiteboard, uploading its images", async () => {
    mocks.create.mockResolvedValue({ id: "drw_new", title: "Sketch" });
    mocks.upload.mockResolvedValue({
      assetId: "asset_1",
      fileId: "file_1",
      mimeType: "image/png",
      created: 1,
    });
    const doc = new Y.Doc();
    mocks.withToolDoc.mockImplementation(
      async (_kind: string, _space: string, _id: string, fn: (doc: Y.Doc) => unknown) => fn(doc),
    );
    const text = serializeExcalidrawFile({
      elements: [rectangle, image],
      viewBackgroundColor: "#101010",
      files: { file_1: file } as never,
    });
    const created = await importExcalidrawFile(
      "space-1",
      new File([text], "Sketch.excalidraw", { type: "application/json" }),
    );
    expect(created.id).toBe("drw_new");
    expect(mocks.create).toHaveBeenCalledWith("space-1", "Sketch");
    expect(mocks.withToolDoc).toHaveBeenCalledWith(
      "drawing",
      "space-1",
      "drw_new",
      expect.any(Function),
    );
    expect(mocks.upload).toHaveBeenCalledWith(
      "space-1",
      "drw_new",
      expect.objectContaining({ id: "file_1" }),
    );
    expect([...doc.getMap("drawing:elements").keys()].sort()).toEqual(["img_1", "rect_1"]);
    expect(doc.getMap("drawing:files").get("file_1")).toMatchObject({ assetId: "asset_1" });
    expect(doc.getMap("drawing:scene").get("viewBackgroundColor")).toBe("#101010");
  });
});
