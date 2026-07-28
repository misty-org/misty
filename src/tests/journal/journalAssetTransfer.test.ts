import { webcrypto } from "node:crypto";
import type { BinaryFileData, DataURL } from "@excalidraw/excalidraw/types";
import type { FileId } from "@excalidraw/excalidraw/element/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spaceRequestMock = vi.fn();

vi.mock("@/stores/spaces/useSpacesBackendStore", () => ({
  spaceRequest: (...args: unknown[]) => spaceRequestMock(...args),
}));

import {
  clearJournalAssetCache,
  resolveJournalAssetUrl,
  uploadJournalAsset,
} from "@/features/journal/assets/journalAssetTransfer";
import { uploadDrawingBinaryFile } from "@/features/drawings/drawingAssets";

const pngBytes = new TextEncoder().encode("png fixture");
const pngSHA256 = "d5057fbbb9b08de9e05cbef10bcf6d8cee42f33995d9ea2e7245d6b75c3988d1";

describe("Journal binary asset transfer", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: webcrypto,
    });
    spaceRequestMock.mockReset();
    vi.stubGlobal("fetch", vi.fn());
    clearJournalAssetCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uploads image bytes directly to R2 and finalizes only metadata through Misty", async () => {
    const file = new File(["abc"], "diagram.png", { type: "image/png" });
    spaceRequestMock
      .mockResolvedValueOnce({
        upload: { id: "upload-1" },
        transfer: {
          url: "https://account.r2.cloudflarestorage.com/signed-put",
          method: "PUT",
          headers: {
            "Content-Type": "image/png",
            "x-amz-checksum-sha256": "signed-checksum",
          },
        },
        finalize: {
          headers: { "X-Misty-Library-Upload-Token": "finalize-token" },
        },
      })
      .mockResolvedValueOnce({
        drawing_asset: {
          id: "drawingasset-1",
          excalidraw_file_id: "file-1",
        },
      });
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 200 }));

    const asset = await uploadJournalAsset({
      kind: "drawing",
      spaceId: "space-1",
      resourceId: "drawing-1",
      externalFileId: "file-1",
      file,
    });

    expect(asset.id).toBe("drawingasset-1");
    const initiation = JSON.parse(
      (spaceRequestMock.mock.calls[0]?.[1] as RequestInit).body as string,
    );
    expect(initiation).toMatchObject({
      file_id: "file-1",
      byte_size: 3,
      mime_type: "image/png",
      sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://account.r2.cloudflarestorage.com/signed-put",
      expect.objectContaining({
        method: "PUT",
        body: file,
        credentials: "omit",
      }),
    );
    expect(spaceRequestMock.mock.calls[1]).toEqual([
      "/spaces/space-1/drawings/drawing-1/assets/uploads/upload-1/finalize",
      {
        method: "POST",
        headers: { "X-Misty-Library-Upload-Token": "finalize-token" },
      },
    ]);
  });

  it("refuses any Journal upload URL that would send bytes through Misty", async () => {
    spaceRequestMock.mockResolvedValue({
      upload: { id: "upload-1" },
      transfer: {
        url: "/spaces/space-1/library/uploads/upload-1/content",
        method: "PUT",
        headers: {},
      },
    });

    await expect(
      uploadJournalAsset({
        kind: "note",
        spaceId: "space-1",
        resourceId: "note-1",
        file: new File(["abc"], "note.png", { type: "image/png" }),
      }),
    ).rejects.toThrow("direct Cloudflare R2 upload");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("downloads from R2 directly and verifies size and SHA-256 before rendering", async () => {
    spaceRequestMock.mockResolvedValue({
      url: "https://account.r2.cloudflarestorage.com/signed-get",
      expires_at: "2026-07-28T12:00:00Z",
      filename: "drawing.png",
      mime_type: "image/png",
      byte_size: pngBytes.byteLength,
      sha256: pngSHA256,
    });
    vi.mocked(fetch).mockResolvedValue(
      new Response(pngBytes, {
        status: 200,
        headers: { "Content-Type": "image/png" },
      }),
    );

    const result = await resolveJournalAssetUrl(
      "/spaces/space-1/drawings/drawing-1/assets/asset-1/download",
    );

    expect(result).toBe("data:image/png;base64,cG5nIGZpeHR1cmU=");
    expect(fetch).toHaveBeenCalledWith("https://account.r2.cloudflarestorage.com/signed-get", {
      credentials: "omit",
    });
  });

  it("rejects downloaded bytes when the checksum is not the authorized checksum", async () => {
    spaceRequestMock.mockResolvedValue({
      url: "https://account.r2.cloudflarestorage.com/signed-get",
      expires_at: "2026-07-28T12:00:00Z",
      filename: "drawing.png",
      mime_type: "image/png",
      byte_size: pngBytes.byteLength,
      sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    vi.mocked(fetch).mockResolvedValue(new Response(pngBytes, { status: 200 }));

    await expect(
      resolveJournalAssetUrl("/spaces/space-1/drawings/drawing-1/assets/asset-bad/download"),
    ).rejects.toThrow("checksum");
  });

  it("shares only an R2 asset reference in the drawing CRDT metadata", async () => {
    spaceRequestMock
      .mockResolvedValueOnce({
        upload: { id: "upload-2" },
        transfer: {
          url: "https://account.r2.cloudflarestorage.com/signed-put-2",
          method: "PUT",
          headers: { "Content-Type": "image/png" },
        },
        finalize: { headers: { "X-Misty-Library-Upload-Token": "token-2" } },
      })
      .mockResolvedValueOnce({
        drawing_asset: {
          id: "drawingasset-2",
          excalidraw_file_id: "file-2",
        },
      });
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (String(input).startsWith("data:")) {
        return new Response(pngBytes, {
          status: 200,
          headers: { "Content-Type": "image/png" },
        });
      }
      return new Response(null, { status: 200 });
    });
    const file: BinaryFileData = {
      id: "file-2" as FileId,
      mimeType: "image/png",
      dataURL: "data:image/png;base64,cG5nIGZpeHR1cmU=" as DataURL,
      created: 123,
    };

    const reference = await uploadDrawingBinaryFile("space-1", "drawing-1", file);

    expect(reference).toEqual({
      assetId: "drawingasset-2",
      fileId: "file-2",
      mimeType: "image/png",
      created: 123,
    });
    expect(JSON.stringify(reference)).not.toContain("data:image");
  });
});
