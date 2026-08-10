import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SIGNED_DOWNLOAD_HEADER,
  parseSignedDownload,
  readDownloadBlob,
} from "@/services/spaces/signed-download";

function signedResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { [SIGNED_DOWNLOAD_HEADER]: "1", "Content-Type": "application/json" },
  });
}

describe("signed downloads", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns the proxied body unchanged when the marker is absent", async () => {
    // A user's own uploaded .json file must not be mistaken for a descriptor.
    const response = new Response('{"url":"https://evil.example/x"}', {
      headers: { "Content-Type": "application/json" },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const blob = await readDownloadBlob(response);

    expect(await blob.text()).toBe('{"url":"https://evil.example/x"}');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("follows the signed URL without Misty credentials", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response("file bytes")));
    vi.stubGlobal("fetch", fetchMock);

    const blob = await readDownloadBlob(
      signedResponse({
        url: "https://account.r2.cloudflarestorage.com/misty/library/x?X-Amz-Signature=abc",
        expires_at: "2026-07-26T00:00:00Z",
        filename: "report.pdf",
      }),
    );

    expect(await blob.text()).toBe("file bytes");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("r2.cloudflarestorage.com");
    // Misty cookies and Authorization must never reach a third-party origin.
    expect(init.credentials).toBe("omit");
    expect(init).not.toHaveProperty("headers");
  });

  it("refuses a descriptor that is not an absolute https URL", () => {
    expect(parseSignedDownload('{"url":"/spaces/space_1/library"}')).toBeNull();
    expect(parseSignedDownload('{"url":"http://insecure.example/x"}')).toBeNull();
    expect(parseSignedDownload('{"url":"javascript:alert(1)"}')).toBeNull();
    expect(parseSignedDownload("not json")).toBeNull();
    expect(parseSignedDownload('{"expires_at":"now"}')).toBeNull();
  });

  it("throws when the server marks a descriptor but sends an unusable one", async () => {
    await expect(readDownloadBlob(signedResponse({ url: "/relative" }))).rejects.toThrow(
      "unusable download link",
    );
  });

  it("surfaces a CORS or network failure on the signed URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("", { status: 403 }))),
    );

    await expect(
      readDownloadBlob(signedResponse({ url: "https://account.r2.cloudflarestorage.com/x" })),
    ).rejects.toThrow("CORS");
  });
});
