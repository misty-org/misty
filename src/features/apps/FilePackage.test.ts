import { expect, it, vi } from "vitest";
import type { MistyAppSDK, MistyComponentContext } from "@misty/sdk";
import files from "../../../../misty-apps/apps/files/index";
it("the downloaded Files entry uses the complete workspace for both routes and releases it", async () => {
  const view = { update: vi.fn(), unmount: vi.fn() };
  const misty = {
    navigation: { setItems: vi.fn() },
    fileSystem: { mountWorkspace: vi.fn(async () => view) },
  } as unknown as MistyAppSDK;
  const context: MistyComponentContext = {
    instanceId: "v",
    route: "/apps/files",
    active: true,
    appearance: { mode: "dark" },
  };
  const root = document.createElement("div");
  const controller = new AbortController();
  const app = await files.mount({ root, misty, context, signal: controller.signal });
  expect(misty.fileSystem.mountWorkspace).toHaveBeenCalledWith(root, {
    view: "explorer",
    active: true,
    extractDocumentText: expect.any(Function),
    renderPdf: expect.any(Function),
    renderVideo: expect.any(Function),
    renderPhoto: expect.any(Function),
  });
  app.update({ ...context, route: "/apps/files?view=transfers" });
  expect(view.update).toHaveBeenLastCalledWith(
    expect.objectContaining({ view: "transfers", active: true }),
  );
  app.update(context);
  expect(view.update).toHaveBeenLastCalledWith(
    expect.objectContaining({ view: "explorer", active: true }),
  );
  controller.abort();
  await app.unmount();
  expect(view.unmount).toHaveBeenCalledTimes(1);
});
