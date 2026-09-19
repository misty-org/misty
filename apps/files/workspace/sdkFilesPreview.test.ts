import { describe, expect, it, vi } from "vitest";
import { createSdkCodeFileFixture } from "../../code/workspace/sdkCodeProject.fixture";
import { createSdkFilesStore } from "./sdkFilesStore";
import { createSdkFilesPreviewRuntime } from "./sdkFilesPreview";

describe("sdkFilesPreview", () => {
  it("streams video and audio through owned file URLs without reading whole buffers", async () => {
    const fixture = createSdkCodeFileFixture();
    const lifetime = new AbortController();
    const files = createSdkFilesStore(fixture.sdk, lifetime.signal);
    const folder = (await files.openFolder())!;
    await files.navigate(`${folder.root}/src`);
    const readBytes = vi.spyOn(files, "readBytes");
    const previewUrl = vi.spyOn(files, "previewUrl");
    const runtime = createSdkFilesPreviewRuntime(files, { Error: () => null });
    for (const [name, kind] of [
      ["clip.mp4", "video"],
      ["song.mp3", "audio"],
    ]) {
      await files.create(name, "file");
      const path = `${folder.root}/src/${name}`;
      const resource = await runtime.load(
        { path, name, extension: name.split(".")[1] },
        lifetime.signal,
      );
      expect(resource.kind).toBe(kind);
      expect(resource.url).toBe(`asset://localhost/${name}`);
      expect(previewUrl).toHaveBeenLastCalledWith(path);
    }
    expect(readBytes).not.toHaveBeenCalled();
    await expect(
      runtime.load(
        { path: "/ungranted/movie.mp4", name: "movie.mp4", extension: "mp4" },
        lifetime.signal,
      ),
    ).rejects.toThrow("Choose the folder");
    lifetime.abort();
    await files.close();
  });
  it("renders images through the bounded image service instead of reading full-size buffers", async () => {
    const fixture = createSdkCodeFileFixture();
    const lifetime = new AbortController();
    const files = createSdkFilesStore(fixture.sdk, lifetime.signal);
    const folder = (await files.openFolder())!;
    await files.navigate(`${folder.root}/src`);
    await files.create("thumbnail.png", "file");
    const path = `${folder.root}/src/thumbnail.png`;
    const readBytes = vi.spyOn(files, "readBytes");
    const previewImage = vi.spyOn(files, "previewImage");
    const resource = await createSdkFilesPreviewRuntime(files, { Error: () => null }).load(
      { path, name: "thumbnail.png", extension: "png" },
      lifetime.signal,
    );
    expect(resource.kind).toBe("image");
    expect(resource.url?.startsWith("blob:")).toBe(true);
    expect(previewImage).toHaveBeenCalledWith(path, 2048);
    expect(readBytes).not.toHaveBeenCalled();
    lifetime.abort();
    await files.close();
  });
});
