import { expect, it, vi } from "vitest";
import { createFileHostSDK } from "./file-host.js";
import type { MistyCall } from "./transport.js";

it("requests media URLs only through the typed owned-file service", async () => {
  const request = vi.fn(async () => "asset://localhost/movie.mp4");
  const files = createFileHostSDK(request as MistyCall, { request });
  expect(await files.previewUrl("owned-file")).toBe("asset://localhost/movie.mp4");
  expect(request).toHaveBeenCalledWith("files.previewUrl", { handle: "owned-file" });
  await expect(files.previewUrl("")).rejects.toThrow();
  expect(request).toHaveBeenCalledTimes(1);
});
