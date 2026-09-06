import { expect, it, vi } from "vitest";
import type { MistyBrowserSDK } from "@misty/sdk";
import { createSdkBrowserController } from "./sdkBrowserController";
const geometry = {
  bounds: { x: 10, y: 50, width: 500, height: 300 },
  visible: true,
  nativeLiveResize: true,
};
function fixture() {
  const stop = vi.fn();
  const view = {
    handle: crypto.randomUUID(),
    contextId: crypto.randomUUID(),
    url: "https://example.com",
  };
  const browser = {
    create: vi.fn(async () => view),
    layout: vi.fn(async () => {}),
    subscribe: vi.fn(async () => stop),
    close: vi.fn(async () => {}),
  };
  const callbacks = { ready: vi.fn(), event: vi.fn(), error: vi.fn() };
  const controller = createSdkBrowserController(browser as unknown as MistyBrowserSDK, callbacks);
  return { browser, controller, callbacks, stop, view };
}
it("defers native creation while hidden and applies only the newest layout during creation", async () => {
  const f = fixture();
  let finish!: () => void;
  f.browser.create.mockImplementation(async () => {
    await new Promise<void>((done) => {
      finish = done;
    });
    return f.view;
  });
  f.controller.update({ ...geometry, visible: false });
  await Promise.resolve();
  expect(f.browser.create).not.toHaveBeenCalled();
  f.controller.update(geometry);
  await vi.waitFor(() => expect(f.browser.create).toHaveBeenCalledOnce());
  f.controller.update({ ...geometry, bounds: { ...geometry.bounds, width: 600 } });
  f.controller.update({ ...geometry, bounds: { ...geometry.bounds, width: 700 } });
  finish();
  await vi.waitFor(() =>
    expect(f.browser.layout).toHaveBeenCalledExactlyOnceWith(f.view.handle, {
      ...geometry,
      bounds: { ...geometry.bounds, width: 700 },
    }),
  );
  f.controller.update({ ...geometry, bounds: { ...geometry.bounds, width: 700 } });
  await Promise.resolve();
  expect(f.browser.layout).toHaveBeenCalledOnce();
  await f.controller.close();
  expect(f.stop).toHaveBeenCalledOnce();
});
it("waits for late creation and destroys it without publishing a closed view", async () => {
  const f = fixture();
  let finish!: () => void;
  f.browser.create.mockImplementation(async () => {
    await new Promise<void>((done) => {
      finish = done;
    });
    return f.view;
  });
  f.controller.update(geometry);
  const closing = f.controller.close();
  finish();
  await closing;
  await f.controller.close();
  expect(f.browser.close).toHaveBeenCalledExactlyOnceWith(f.view.handle);
  expect(f.callbacks.ready).not.toHaveBeenCalled();
  expect(f.browser.subscribe).not.toHaveBeenCalled();
});
it("releases a subscription that finishes after close and supports retry after a failed creation", async () => {
  const f = fixture();
  f.browser.create.mockRejectedValueOnce(new Error("temporary failure"));
  f.controller.update(geometry);
  await vi.waitFor(() => expect(f.callbacks.error).toHaveBeenCalledOnce());
  let finish!: () => void;
  f.browser.subscribe.mockImplementation(async () => {
    await new Promise<void>((done) => {
      finish = done;
    });
    return f.stop;
  });
  f.controller.update(geometry, true);
  await vi.waitFor(() => expect(f.browser.subscribe).toHaveBeenCalledOnce());
  const closing = f.controller.close();
  finish();
  await closing;
  expect(f.stop).toHaveBeenCalledOnce();
  expect(f.browser.close).toHaveBeenCalledOnce();
});
