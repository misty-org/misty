import { expect, it, vi } from "vitest";
import { createSdkCodeFileFixture } from "@/features/coding-workspace/sdkCodeProject.fixture";
import { openSdkFilesDirectory } from "./sdkFilesDirectory";

it("releases an archive's temporary file grant when its preview closes while keeping the folder usable", async () => {
  const fixture = createSdkCodeFileFixture();
  const request = fixture.request.getMockImplementation()!;
  let handle = "";
  let complete!: (reply: unknown) => void;
  const pending = new Promise((resolve) => {
    complete = resolve;
  });
  fixture.request.mockImplementation(async (input) => {
    if (input.method === "files.listArchive") {
      handle = (input.params as { handle: string }).handle;
      return pending;
    }
    return request(input);
  });
  const folder = (await openSdkFilesDirectory(fixture.sdk))!;
  const lifetime = new AbortController();
  const preview = folder.listArchive(
    `${folder.root}/src/${fixture.file.name}`,
    "zip",
    lifetime.signal,
  );
  const failed = expect(preview).rejects.toThrow("closed");
  await vi.waitFor(() => expect(handle).not.toBe(""));
  expect(fixture.handles.has(handle)).toBe(true);
  lifetime.abort();
  await vi.waitFor(() => expect(fixture.handles.has(handle)).toBe(false));
  complete({ format: "zip", entries: [] });
  await failed;
  expect(fixture.handles.size).toBe(1);
  expect((await folder.list()).entries[0].name).toBe("src");
  await folder.close();
  expect(fixture.handles.size).toBe(0);
});
