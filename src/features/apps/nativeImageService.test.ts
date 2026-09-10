import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  spaceId: "family",
  invoke: vi.fn(),
  service: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("./useAppsStore", () => ({ useAppsStore: { getState: () => ({ spaceId: mocks.spaceId }) } }));
vi.mock("./nativeDocumentService", () => ({ withNativeDocumentService: mocks.service }));
import { invokeFilesImage } from "./nativeImageService";
beforeEach(() => { vi.clearAllMocks(); mocks.spaceId = "family"; });
it("keeps the originating Space and replaces caller-supplied instance authority", async () => {
  let execute!: (instance: string) => Promise<unknown>;
  mocks.service.mockImplementation((_app, _space, run) => {
    execute = run;
    return Promise.resolve();
  });
  await invokeFilesImage("explorer_preview_item", { path: "/chosen/image.png", instance: "foreign" });
  mocks.spaceId = "work";
  await execute("verified-session");
  expect(mocks.service.mock.calls[0].slice(0, 2)).toEqual(["files", "family"]);
  expect(mocks.invoke).toHaveBeenCalledWith("explorer_preview_item", {
    path: "/chosen/image.png", instance: "verified-session",
  });
});
it("uses an SDK caller's Space and never invokes a preview after authorization fails", async () => {
  mocks.service.mockRejectedValue(new Error("Files removed"));
  await expect(invokeFilesImage("explorer_generate_image_thumbnail", { path: "/chosen/image.png" }, "project"))
    .rejects.toThrow("Files removed");
  expect(mocks.service.mock.calls[0].slice(0, 2)).toEqual(["files", "project"]);
  expect(mocks.invoke).not.toHaveBeenCalled();
});
