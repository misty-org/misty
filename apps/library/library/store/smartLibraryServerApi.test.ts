import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as Backend from "@/native";

vi.mock("@/features/auth", () => ({
  isAccountSessionTransitioning: vi.fn(() => false),
  readAccountSessionGeneration: vi.fn(() => 0),
  readAccountAuthToken: vi.fn().mockResolvedValue("smart-library-token"),
}));

vi.mock("@/native", async (importOriginal) => ({
  ...(await importOriginal<typeof Backend>()),
  appSnapshot: vi.fn().mockRejectedValue(new Error("not running in Tauri")),
}));

import { managedAiRequest } from "@/features/agents";
import {
  approveSmartLibrarySample,
  completeSemanticReindex,
  planSemanticReindex,
  registerSmartLibraryFolder,
  searchSemanticAssets,
} from "../store/useSmartLibraryServerStore";

describe("Smart Library managed API", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv("VITE_MISTY_SERVER_URL", "https://misty.example");
  });

  it("registers only an opaque library ID and source kind", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          folderId: "folder_server_1",
          allowance: {
            sampleImages: 25,
            maximumAnalyzedImages: 500,
            sampleIncluded: false,
            remainingImages: 500,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await registerSmartLibraryFolder({
      clientLibraryId: "lib_opaque",
      sourceKind: "local",
      pilotLimit: 500,
    });

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as Record<
      string,
      unknown
    >;
    expect(body).toEqual({ clientLibraryId: "lib_opaque", sourceKind: "local", pilotLimit: 500 });
    expect(JSON.stringify(body)).not.toContain("/Users/");
  });

  it("rejects analysis batches larger than eight before network usage", () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const assets = Array.from({ length: 9 }, (_, index) => ({
      assetId: `asset_${index}`,
      fingerprint: `fp_${index}`,
      mimeType: "image/jpeg",
      assetKind: "image",
      base64: "preview",
    }));
    expect(() => approveSmartLibrarySample("folder_1", assets, true)).toThrow("one to eight");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("submits bounded extracted text for non-visual files without inventing image bytes", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          folderId: "folder_1",
          phase: "sample_processing",
          successfulImages: 0,
          failedImages: 0,
          queuedImages: 1,
          batches: [],
          estimate: {},
          nextResultSequence: 0,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await approveSmartLibrarySample(
      "folder_1",
      [
        {
          assetId: "asset_doc",
          fingerprint: "opaque_fingerprint",
          assetKind: "document",
          mimeType: "application/pdf",
          extractedText: "A bounded report excerpt",
          metadata: { pageCount: "12" },
          truncated: true,
        },
      ],
      true,
    );

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as {
      previews: Array<Record<string, unknown>>;
    };
    expect(body.previews[0]).not.toHaveProperty("base64");
    expect(body.previews[0]).toMatchObject({
      assetKind: "document",
      extractedText: "A bounded report excerpt",
      truncated: true,
    });
    expect(JSON.stringify(body)).not.toContain("/Users/");
  });

  it("searches the account catalog without sending device paths", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          hits: [],
          queryModel: "embedding",
          indexVersion: "2",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await searchSemanticAssets("pikachu file manager", { limit: 8 });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://misty.example/api/ai/smart-library/search");
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as Record<
      string,
      unknown
    >;
    expect(body).toEqual({ query: "pikachu file manager", limit: 8 });
    expect(JSON.stringify(body)).not.toContain("/Users/");
  });

  it("plans and explicitly completes bounded path-free reindex work", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jobId: "job_1",
            status: "planned",
            targetVersion: 2,
            embeddingModel: "embedding",
            assets: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jobId: "job_1",
            status: "completed",
            completedAssets: 1,
            failedAssets: 0,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

    await planSemanticReindex({ folderId: "folder_1", limit: 100 });
    await completeSemanticReindex("job_1", [
      {
        assetId: "asset_1",
        fingerprint: "fingerprint",
        assetKind: "document",
        mimeType: "application/pdf",
        extractedText: "Quarterly report",
      },
    ]);

    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
      folderId: "folder_1",
      limit: 100,
    });
    const completion = JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string) as Record<
      string,
      unknown
    >;
    expect(JSON.stringify(completion)).toContain("Quarterly report");
    expect(JSON.stringify(completion)).not.toContain("/Users/");
  });

  it("shows a safe server message instead of raw JSON for media failures", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "visual_embedding_failed",
          message: "The agent could not index the scenes. No hosted AI usage was consumed.",
          detail: "private provider detail that must stay hidden",
        }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(
      managedAiRequest("/ai/media-search/chunks", { method: "POST", body: "{}" }),
    ).rejects.toThrow("The agent could not index the scenes. No hosted AI usage was consumed.");
  });
});
