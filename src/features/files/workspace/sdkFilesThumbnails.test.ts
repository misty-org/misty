import { describe, expect, it, vi } from "vitest";
import { createSdkCodeFileFixture } from "../../code/workspace/sdkCodeProject.fixture";
import { createSdkFilesStore } from "./sdkFilesStore";
import { createSdkFilesThumbnails } from "./sdkFilesThumbnails";

describe("sdkFilesThumbnails", () => {
  it("generates thumbnails via files.previewImage without reading 64MB buffers or using canvas", async () => {
    const fixture = createSdkCodeFileFixture();
    const lifetime = new AbortController();
    const files = createSdkFilesStore(fixture.sdk, lifetime.signal);
    const readBytesSpy = vi.spyOn(files, "readBytes");
    const previewImageSpy = vi.spyOn(files, "previewImage");
    const createElementSpy = vi.spyOn(document, "createElement");

    const folder = (await files.openFolder())!;
    await files.navigate(`${folder.root}/src`);
    await files.create("picture.png", "file");

    const thumbnails = createSdkFilesThumbnails(files, lifetime.signal);

    const entry = {
      id: `${folder.root}/src/picture.png`,
      path: `${folder.root}/src/picture.png`,
      name: "picture.png",
      kind: "file" as const,
      extension: "png",
      bytes: 100,
      sizeBytes: 100,
      modifiedMs: 1,
      createdMs: 1,
      remoteModified: null,
      mimeType: "image/png",
      hidden: false,
      readonly: false,
      location: { kind: "local" as const, providerType: null, remoteName: null, remotePath: null },
    };

    let resolvedUrl: string | null = null;
    await new Promise<void>((resolve) => {
      thumbnails.requestThumbnail(entry, 256, (url) => {
        if (url) {
          resolvedUrl = url;
          resolve();
        }
      });
    });

    expect(resolvedUrl).toBeTruthy();
    expect(resolvedUrl!.startsWith("blob:")).toBe(true);
    expect(previewImageSpy).toHaveBeenCalledWith(entry.path, 256);
    expect(readBytesSpy).not.toHaveBeenCalled();
    // Verify no canvas element was created on the main DOM thread
    expect(createElementSpy).not.toHaveBeenCalledWith("canvas");

    thumbnails.close();
    lifetime.abort();
    await files.close();
  });
});
