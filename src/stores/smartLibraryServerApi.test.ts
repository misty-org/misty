import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../pages/Account/shared/authTokenStore", () => ({
  readAccountAuthToken: vi.fn().mockResolvedValue("smart-library-token"),
}));

vi.mock("../api/misty", () => ({
  appSnapshot: vi.fn().mockRejectedValue(new Error("not running in Tauri")),
}));

import { approveSmartLibrarySample, registerSmartLibraryFolder } from "./smartLibraryServerApi";

describe("Smart Library managed API", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv("VITE_MISTY_SERVER_URL", "https://misty.example");
  });

  it("registers only an opaque library ID and source kind", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      folderId: "folder_server_1",
      allowance: { sampleImages: 25, maximumAnalyzedImages: 500, sampleIncluded: true, remainingImages: 500 },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    await registerSmartLibraryFolder({ clientLibraryId: "lib_opaque", sourceKind: "local", pilotLimit: 500 });

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as Record<string, unknown>;
    expect(body).toEqual({ clientLibraryId: "lib_opaque", sourceKind: "local", pilotLimit: 500 });
    expect(JSON.stringify(body)).not.toContain("/Users/");
  });

  it("rejects analysis batches larger than eight before network usage", () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const assets = Array.from({ length: 9 }, (_, index) => ({ assetId: `asset_${index}`, fingerprint: `fp_${index}`, mimeType: "image/jpeg" as const, base64: "preview" }));
    expect(() => approveSmartLibrarySample("folder_1", assets, true)).toThrow("one to eight");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
