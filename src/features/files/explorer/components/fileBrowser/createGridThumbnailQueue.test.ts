import { expect, it, vi } from "vitest";
import type { FileEntry } from "@/native/contracts";
import { createGridThumbnailQueue } from "./createGridThumbnailQueue";

it("disposes stale and late thumbnail URLs without publishing them to another listing", async () => {
  const pending: ((url: string) => void)[] = [];
  const load = vi.fn(() => new Promise<string>((resolve) => pending.push(resolve)));
  const release = vi.fn(),
    old = vi.fn(),
    current = vi.fn(),
    late = vi.fn();
  const queue = createGridThumbnailQueue(load, release);
  const entry: FileEntry = {
    id: "image",
    path: "/chosen/image.png",
    name: "image.png",
    extension: "png",
    kind: "file",
    mimeType: "image/png",
    remoteModified: null,
    sizeBytes: 32,
    modifiedMs: 1,
    createdMs: 1,
    readonly: true,
    hidden: false,
    location: { kind: "local", providerType: null, remoteName: null, remotePath: null },
  };
  queue.requestGridThumbnail(entry, 128, old);
  queue.clear();
  queue.requestGridThumbnail(entry, 128, current);
  pending[0]("blob:old");
  pending[1]("blob:current");
  await vi.waitFor(() => expect(current).toHaveBeenCalledWith("blob:current"));
  expect(old).not.toHaveBeenCalled();
  expect(release).toHaveBeenCalledWith("blob:old");
  queue.requestGridThumbnail({ ...entry, path: "/chosen/late.png" }, 128, late);
  queue.close();
  pending[2]("blob:late");
  await vi.waitFor(() => expect(release).toHaveBeenCalledWith("blob:late"));
  expect(late).not.toHaveBeenCalled();
  expect(release.mock.calls.map(([url]) => url).sort()).toEqual([
    "blob:current",
    "blob:late",
    "blob:old",
  ]);
});
