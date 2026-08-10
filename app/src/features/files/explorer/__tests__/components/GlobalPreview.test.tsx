import { describe, expect, it, vi } from "vitest";

vi.mock("@/features/files/native", () => ({
  archiveList: vi.fn(),
  explorerOpenPath: vi.fn(),
  explorerPrepareOpenItem: vi.fn(),
  explorerPreviewItem: vi.fn(),
  explorerSavePreviewItem: vi.fn(),
}));
vi.mock("@/shared/platform/tauri", () => ({
  safeTauriAssetUrl: (path: string) => `asset://${path}`,
}));
vi.mock("@tauri-apps/api/image", () => ({
  Image: { fromBytes: vi.fn(async () => ({ close: vi.fn() })) },
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeImage: vi.fn() }));

import { globalPreviewKindForSource } from "../../components/GlobalPreview";

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
