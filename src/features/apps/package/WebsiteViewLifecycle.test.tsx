import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { MistyAppSDK, MistyBrowserEvent, MistyComponentContext } from "@misty/sdk";
import { SDKBrowserView } from "../../../../../misty-apps/apps/browser/workspace/SDKBrowserView";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("sleeps between layout changes, coalesces notifications, and releases observers on close", async () => {
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation((id) => {
    frames.delete(id);
  });
  const observed: Array<{
    callback: ResizeObserverCallback;
    disconnect: ReturnType<typeof vi.fn>;
  }> = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      disconnect = vi.fn();
      observe() {}
      unobserve() {}
      constructor(callback: ResizeObserverCallback) {
        observed.push({ callback, disconnect: this.disconnect });
      }
    },
  );
  let rect = new DOMRect(0, 44, 500, 300);
  const readBounds = vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(() => rect);
  let receive: (event: MistyBrowserEvent) => void = () => {};
  const view = { handle: "page", contextId: "page", url: "https://example.com/" };
  const browser = {
    create: vi.fn(async () => view),
    subscribe: vi.fn(async (_handle, callback) => {
      receive = callback;
      return () => {};
    }),
    layout: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    overlay: vi.fn(async () => {}),
  };
  const context: MistyComponentContext = {
    instanceId: "page",
    route: "/apps/browser",
    active: true,
    appearance: { mode: "dark" },
  };
  const props = {
    services: {
      misty: { browser } as unknown as MistyAppSDK,
      report: vi.fn(),
      register: () => () => {},
    },
    context,
    initialUrl: view.url,
    provider: { id: "instagram" as const, accountId: "personal" },
  };
  const drain = async () => {
    for (let pass = 0; pass < 8; pass++) {
      await act(async () => {
        const pending = [...frames.values()];
        frames.clear();
        pending.forEach((callback) => callback(performance.now()));
      });
      if (!frames.size) return;
    }
    throw new Error("Browser layout is polling continuously");
  };
  const rendered = render(<SDKBrowserView {...props} />);
  await drain();
  act(() => receive({ type: "page", phase: "finished", url: view.url }));
  await drain();
  expect(browser.create).toHaveBeenCalledOnce();
  expect(frames.size).toBe(0);

  const idleReads = readBounds.mock.calls.length;
  await act(async () => {
    await Promise.resolve();
  });
  expect(readBounds).toHaveBeenCalledTimes(idleReads);

  browser.layout.mockClear();
  rect = new DOMRect(30, 60, 650, 400);
  act(() => {
    for (let i = 0; i < 10; i++) observed[0].callback([], {} as ResizeObserver);
  });
  expect(frames.size).toBe(1);
  await drain();
  expect(browser.layout).toHaveBeenCalledExactlyOnceWith(
    view.handle,
    expect.objectContaining({
      bounds: { x: 30, y: 60, width: 650, height: 400 },
      visible: true,
    }),
  );

  // A host resume/zoom notification must reconcile even unchanged geometry.
  browser.layout.mockClear();
  act(() => receive({ type: "layout" }));
  await drain();
  expect(browser.layout).toHaveBeenCalledOnce();

  // Position-only ancestor changes do not necessarily emit ResizeObserver.
  rect = new DOMRect(80, 60, 650, 400);
  await act(async () => {
    rendered.container.style.marginLeft = "50px";
  });
  await drain();
  expect(browser.layout).toHaveBeenLastCalledWith(
    view.handle,
    expect.objectContaining({
      bounds: { x: 80, y: 60, width: 650, height: 400 },
    }),
  );

  // Responsive native resizing settles once, without leaving a polling loop.
  browser.layout.mockClear();
  rect = new DOMRect(80, 60, 700, 400);
  act(() => window.dispatchEvent(new Event("resize")));
  await drain();
  expect(browser.layout).not.toHaveBeenCalled();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 150));
  });
  await drain();
  expect(browser.layout).toHaveBeenCalledExactlyOnceWith(
    view.handle,
    expect.objectContaining({
      bounds: { x: 80, y: 60, width: 700, height: 400 },
    }),
  );
  expect(frames.size).toBe(0);

  rendered.rerender(<SDKBrowserView {...props} context={{ ...context, active: false }} />);
  await drain();
  expect(browser.layout).toHaveBeenLastCalledWith(
    view.handle,
    expect.objectContaining({ visible: false }),
  );
  expect(frames.size).toBe(0);
  act(() => observed[0].callback([], {} as ResizeObserver));
  expect(frames.size).toBe(1);
  rendered.unmount();
  expect(frames.size).toBe(0);
  expect(observed[0].disconnect).toHaveBeenCalledOnce();
  await act(async () => {
    rendered.container.style.marginLeft = "100px";
  });
  window.dispatchEvent(new Event("scroll"));
  expect(frames.size).toBe(0);
  await waitFor(() => expect(browser.close).toHaveBeenCalledOnce());
});

it("loads on first activation and retains the native website through tab switches and callback changes", async () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 44, 500, 300),
  );
  let receive: (event: MistyBrowserEvent) => void = () => {};
  const view = { handle: "instagram-view", contextId: "page", url: "https://www.instagram.com/" };
  const browser = {
    create: vi.fn(async () => view),
    subscribe: vi.fn(async (_handle, listener) => {
      receive = listener;
      return () => {};
    }),
    layout: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    navigate: vi.fn(async () => {}),
    reload: vi.fn(async () => {}),
    overlay: vi.fn(async () => {}),
  };
  const misty = { browser } as unknown as MistyAppSDK;
  const context: MistyComponentContext = {
    instanceId: "instagram-tab",
    route: "/apps/social?provider=instagram",
    active: false,
    focused: false,
    appearance: { mode: "dark" },
  };
  const props = (active: boolean, accountId = "personal") => ({
    services: { misty, report: vi.fn(), register: () => () => {} },
    context: { ...context, active, focused: active },
    provider: { id: "instagram" as const, accountId },
    initialUrl: "https://www.instagram.com/",
    onView: vi.fn(),
  });
  const rendered = render(<SDKBrowserView {...props(false)} />);
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
  expect(browser.create).not.toHaveBeenCalled();
  expect(rendered.getByRole("status", { name: "Loading website" }).textContent).toBe("");

  rendered.rerender(<SDKBrowserView {...props(true)} />);
  await waitFor(() => expect(browser.subscribe).toHaveBeenCalledOnce());
  await waitFor(() =>
    expect(browser.layout).toHaveBeenLastCalledWith(
      view.handle,
      expect.objectContaining({ visible: false }),
    ),
  );
  act(() =>
    receive({ type: "page", phase: "finished", url: "https://www.instagram.com/direct/t/123/" }),
  );
  await waitFor(() =>
    expect(browser.layout).toHaveBeenLastCalledWith(
      view.handle,
      expect.objectContaining({ visible: true }),
    ),
  );
  expect(rendered.queryByRole("status", { name: "Loading website" })).toBeNull();

  for (let index = 0; index < 2; index++) {
    rendered.rerender(<SDKBrowserView {...props(false)} />);
    await waitFor(() =>
      expect(browser.layout).toHaveBeenLastCalledWith(
        view.handle,
        expect.objectContaining({ visible: false }),
      ),
    );
    rendered.rerender(<SDKBrowserView {...props(true)} />);
    await waitFor(() =>
      expect(browser.layout).toHaveBeenLastCalledWith(
        view.handle,
        expect.objectContaining({ visible: true }),
      ),
    );
  }
  // Later navigations keep the loaded content visible, without reinstating the initial loader.
  act(() =>
    receive({ type: "page", phase: "started", url: "https://www.instagram.com/direct/t/456/" }),
  );
  expect(rendered.queryByRole("status", { name: "Loading website" })).toBeNull();
  expect(browser.create).toHaveBeenCalledOnce();
  expect(browser.close).not.toHaveBeenCalled();
  expect(browser.navigate).not.toHaveBeenCalled();
  expect(browser.reload).not.toHaveBeenCalled();

  // A deliberate account change still isolates the new website session.
  rendered.rerender(<SDKBrowserView {...props(true, "work")} />);
  await waitFor(() => expect(browser.create).toHaveBeenCalledTimes(2));
  expect(browser.close).toHaveBeenCalledOnce();
  rendered.unmount();
  await waitFor(() => expect(browser.close).toHaveBeenCalledTimes(2));
});
