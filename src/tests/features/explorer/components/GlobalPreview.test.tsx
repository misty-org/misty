import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { closeNativeImage, savePreview, writeImage } = vi.hoisted(() => ({
  closeNativeImage: vi.fn(),
  savePreview: vi.fn(),
  writeImage: vi.fn(),
}));

vi.mock("@/stores/backend", () => ({
  archiveList: vi.fn(),
  explorerOpenPath: vi.fn(),
  explorerPrepareOpenItem: vi.fn(),
  explorerPreviewItem: vi.fn(),
  explorerSavePreviewItem: savePreview,
}));
vi.mock("@/platform/tauri", () => ({
  safeTauriAssetUrl: (path: string) => `asset://${path}`,
}));
vi.mock("@tauri-apps/api/image", () => ({
  Image: { fromBytes: vi.fn(async () => ({ close: closeNativeImage })) },
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeImage }));

import {
  GlobalPreviewDialog,
  globalPreviewKindForSource,
} from "@/features/explorer/components/GlobalPreview";

describe("globalPreviewKindForSource", () => {
  it.each([
    ["md", "text/markdown", "markdown"],
    ["pdf", "application/pdf", "pdf"],
    ["docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "document"],
    ["xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "document"],
    [
      "pptx",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "document",
    ],
    ["mp3", "audio/mpeg", "audio"],
    ["ogg", "audio/ogg", "audio"],
    ["mp4", "video/mp4", "video"],
    ["mov", "video/quicktime", "video"],
    ["png", "image/png", "image"],
    ["zip", "application/zip", "archive"],
  ] as const)("routes .%s through the %s reader", (extension, mimeType, expected) => {
    expect(globalPreviewKindForSource(extension, mimeType)).toBe(expected);
  });

  it("reserves the generic fallback for unknown custom formats", () => {
    expect(globalPreviewKindForSource("mistycustom", "application/x-misty-custom")).toBe("generic");
  });
});

describe("GlobalPreviewDialog image editor", () => {
  let container: HTMLDivElement;
  let root: Root;
  const context = {
    save: vi.fn(),
    restore: vi.fn(),
    clearRect: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    drawImage: vi.fn(),
    filter: "",
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([20, 30, 40, 255]) })),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
  };

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    savePreview.mockResolvedValue({
      affectedPaths: ["/Pictures/photo copy.png"],
      parentPath: "/Pictures",
    });
    closeNativeImage.mockResolvedValue(undefined);
    writeImage.mockResolvedValue(undefined);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) =>
      callback(new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" })),
    );
    class EditorImage {
      naturalWidth = 4;
      naturalHeight = 2;
      decoding = "async";
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal("Image", EditorImage);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("applies an image transform and supports Save as Copy and Save", async () => {
    await act(async () => {
      root.render(
        <GlobalPreviewDialog
          source={{ path: "/Pictures/photo.png", name: "photo.png", extension: "png" }}
          onClose={() => undefined}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    const rotate = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Rotate clockwise"]',
    );
    expect(rotate).not.toBeNull();
    await act(async () => {
      rotate?.click();
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(context.rotate).toHaveBeenCalledWith(Math.PI / 2));
    const undo = container.querySelector<HTMLButtonElement>('button[aria-label="Undo"]');
    const redo = container.querySelector<HTMLButtonElement>('button[aria-label="Redo"]');
    expect(undo?.disabled).toBe(false);
    await act(async () => undo?.click());
    expect(redo?.disabled).toBe(false);
    await act(async () => redo?.click());

    const saveMenu = container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]');
    await act(async () => saveMenu?.click());
    const saveCopy = [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (button) => button.textContent?.includes("Save as copy"),
    );
    await act(async () => {
      saveCopy?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(savePreview).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/Pictures/photo.png", bytes: [1, 2, 3], saveAsCopy: true }),
    );

    await act(async () => saveMenu?.click());
    const save = [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (button) => button.textContent === "Save",
    );
    savePreview.mockResolvedValueOnce({
      affectedPaths: ["/Pictures/photo.png"],
      parentPath: "/Pictures",
    });
    await act(async () => {
      save?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(savePreview).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/Pictures/photo.png", saveAsCopy: false }),
    );
  });

  it("exposes the reference tool rail and commits text annotations", async () => {
    await act(async () => {
      root.render(
        <GlobalPreviewDialog
          source={{ path: "/Pictures/photo.png", name: "photo.png", extension: "png" }}
          onClose={() => undefined}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    for (const label of ["Selection", "Crop", "Text", "Brush", "Eyedropper", "Shape"]) {
      expect(container.querySelector(`button[aria-label="${label}"]`)).not.toBeNull();
    }
    const toolRail = container.querySelector('nav[aria-label="Image editing tools"]');
    expect(toolRail?.textContent).not.toContain("Undo");
    expect(toolRail?.textContent).not.toContain("Clear");
    await act(async () =>
      container.querySelector<HTMLButtonElement>('button[aria-label="Text"]')?.click(),
    );
    const canvas = container.querySelector("canvas");
    await act(async () =>
      canvas?.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, clientX: 1, clientY: 1 }),
      ),
    );
    await vi.waitFor(() =>
      expect(context.fillText).toHaveBeenCalledWith("Text", expect.any(Number), expect.any(Number)),
    );
  });

  it.each(["gif", "svg"])("opens .%s images directly in the editor", async (extension) => {
    await act(async () => {
      root.render(
        <GlobalPreviewDialog
          source={{ path: `/Pictures/photo.${extension}`, name: `photo.${extension}`, extension }}
          onClose={() => undefined}
        />,
      );
    });
    expect(container.querySelector('nav[aria-label="Image editing tools"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Close preview"]')).toBeNull();
  });

  it("shows editable tags as individual capsules", async () => {
    const saveMetadata = vi.fn().mockResolvedValue(undefined);
    await act(async () => {
      root.render(
        <GlobalPreviewDialog
          source={{
            path: "/Pictures/photo.png",
            name: "photo.png",
            extension: "png",
            tags: ["workflow", "visual"],
          }}
          onClose={() => undefined}
          onSaveMetadata={saveMetadata}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.querySelector('button[title="Edit workflow"]')).not.toBeNull();
    const remove = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Delete tag visual"]',
    );
    await act(async () => remove?.click());
    const saveTags = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.includes("Save tags"),
    );
    await act(async () => {
      saveTags?.click();
      await Promise.resolve();
    });
    expect(saveMetadata).toHaveBeenCalledWith("", ["workflow"]);
  });

  it("places the Save dropdown beside the center tray and leaves only Close on the right", async () => {
    await act(async () => {
      root.render(
        <GlobalPreviewDialog
          source={{ path: "/Pictures/photo.png", name: "photo.png", extension: "png" }}
          onClose={() => undefined}
        />,
      );
    });
    const tray = container.querySelector("[data-editor-history-tray]");
    const saveMenu = container.querySelector("[data-editor-save-menu]");
    const close = container.querySelector<HTMLButtonElement>('button[aria-label="Close editor"]');
    expect(tray?.parentElement?.contains(saveMenu)).toBe(true);
    expect(tray?.parentElement?.contains(close)).toBe(false);
    expect(container.querySelector("[data-editor-action-group]")).toBeNull();
    expect(container.querySelector('button[aria-label="Previous image"]')).toBeNull();
    expect(container.querySelector('button[aria-label="Next image"]')).toBeNull();
  });

  it("copies the rendered edit to the system clipboard from the Save menu", async () => {
    await act(async () => {
      root.render(
        <GlobalPreviewDialog
          source={{ path: "/Pictures/photo.png", name: "photo.png", extension: "png" }}
          onClose={() => undefined}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () =>
      container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')?.click(),
    );
    const copy = [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (button) => button.textContent?.includes("Copy to clipboard"),
    );
    await act(async () => {
      copy?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(writeImage).toHaveBeenCalledTimes(1);
    expect(closeNativeImage).toHaveBeenCalledTimes(1);
  });

  it("groups history, zoom, rotation, and reset in the top editor tray", async () => {
    await act(async () => {
      root.render(
        <GlobalPreviewDialog
          source={{ path: "/Pictures/photo.png", name: "photo.png", extension: "png" }}
          onClose={() => undefined}
        />,
      );
    });
    const tray = container.querySelector("[data-editor-history-tray]");
    for (const label of [
      "Undo",
      "Redo",
      "Zoom out",
      "Zoom in",
      "Rotate clockwise",
      "Reset editor",
    ]) {
      expect(tray?.querySelector(`button[aria-label="${label}"]`)).not.toBeNull();
    }
    expect(tray?.textContent).toContain("100%");
    expect(
      container.querySelector("footer")?.querySelector('button[aria-label="Zoom in"]'),
    ).toBeNull();
  });
});
