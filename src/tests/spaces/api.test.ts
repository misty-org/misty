import { beforeEach, describe, expect, it, vi } from "vitest";

const accountSession = vi.hoisted(() => ({ transitioning: false, generation: 0 }));

vi.mock("@/stores/account/useAuthTokenStore", () => ({
  isAccountSessionTransitioning: () => accountSession.transitioning,
  readAccountSessionGeneration: () => accountSession.generation,
  readAccountAuthToken: vi.fn().mockResolvedValue("signed-in-token"),
}));

vi.mock("@/stores/backend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/stores/backend")>()),
  appSnapshot: vi.fn().mockRejectedValue(new Error("not running in Tauri")),
}));

import {
  fileNameFromPath,
  maxWebviewUploadBytes,
  spacesApi,
  spaceErrorMessage,
  spaceRequest,
} from "@/stores/spaces/useSpacesBackendStore";

beforeEach(() => {
  accountSession.transitioning = false;
  accountSession.generation = 0;
});

describe("fileNameFromPath", () => {
  it("keeps the selected filename for Unix and Windows paths", () => {
    expect(fileNameFromPath("/Users/misty/Pictures/library photo.jpg")).toBe("library photo.jpg");
    expect(fileNameFromPath("C:\\Users\\misty\\Pictures\\library photo.jpg")).toBe(
      "library photo.jpg",
    );
  });
});

describe("spaceErrorMessage", () => {
  it("does not expose raw provider OAuth errors to members", () => {
    expect(
      spaceErrorMessage(
        "provider_not_configured",
        '{"code":"provider_not_configured","provider":"google"}',
      ),
    ).toBe("This provider’s sign-in is not available on the current Misty server.");
  });

  it("describes storage quota errors as an owner-pooled limit", () => {
    const expected =
      "This upload would exceed the Space owner’s shared storage pool. Existing files remain available.";

    expect(spaceErrorMessage("owner_storage_quota_exceeded", "fallback")).toBe(expected);
    expect(spaceErrorMessage("space_storage_quota_exceeded", "fallback")).toBe(expected);
    expect(expected).not.toContain("1 GB");
  });
});

describe("spaceRequest account isolation", () => {
  it("blocks Space requests before network usage during an account switch", async () => {
    accountSession.transitioning = true;
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(spaceRequest("/spaces")).rejects.toMatchObject({
      message: "Wait for the account switch to finish.",
      status: 409,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an old-account response that lands after the account generation changes", async () => {
    let releaseResponse!: (response: Response) => void;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => new Promise<Response>((resolve) => (releaseResponse = resolve)));
    const request = spaceRequest("/spaces");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    accountSession.generation += 1;
    releaseResponse(
      new Response(JSON.stringify({ spaces: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(request).rejects.toMatchObject({ code: "account_changed", status: 409 });
  });

  it("rejects protected Space content whose body completes after an account switch", async () => {
    let releaseBlob!: (blob: Blob) => void;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      blob: () => new Promise<Blob>((resolve) => (releaseBlob = resolve)),
    } as Response);
    const request = spacesApi.libraryContent("space-a", "item-a");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    accountSession.generation += 1;
    releaseBlob(new Blob(["private account A data"]));

    await expect(request).rejects.toMatchObject({ code: "account_changed", status: 409 });
  });

  it("rejects oversized local uploads before buffering their body", async () => {
    const readBody = vi.fn();
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-length": String(maxWebviewUploadBytes + 1) }),
      blob: readBody,
    } as unknown as Response);

    await expect(
      spacesApi.uploadLibraryPath("space-a", "/tmp/too-large.mov", "library"),
    ).rejects.toThrow("up to 128 MB");
    expect(readBody).not.toHaveBeenCalled();
  });
});
