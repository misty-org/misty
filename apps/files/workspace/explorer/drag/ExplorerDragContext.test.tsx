import { act, useMemo, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExplorerDragItem, ExplorerDropZoneSpec } from "../model/interfaces/drag/types";

const mocks = vi.hoisted(() => ({
  cancelPreparation: vi.fn().mockResolvedValue(undefined),
  prepareItems: vi.fn().mockResolvedValue({ items: [], skipped: [] }),
  startDrag: vi
    .fn()
    .mockImplementation(async (_options, callback) => callback({ result: "Dropped" })),
  unlistenDrag: vi.fn(),
  unlistenScale: vi.fn(),
  dragListener: null as null | ((event: { payload: Record<string, unknown> }) => void),
}));

vi.mock("@/features/files/native", () => ({
  explorerCancelDragPreparation: mocks.cancelPreparation,
  explorerPrepareDragItems: mocks.prepareItems,
}));
vi.mock("@/shared/hooks/useAppZoom", () => ({ getAppliedAppZoom: () => 1 }));
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => true }));
vi.mock("../store", () => ({
  useExplorerStore: {
    getState: () => ({ panes: {}, pushNotification: vi.fn(), refreshPane: vi.fn() }),
  },
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: async (listener: typeof mocks.dragListener) => {
      mocks.dragListener = listener;
      return mocks.unlistenDrag;
    },
  }),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    scaleFactor: async () => 2,
    onScaleChanged: async () => mocks.unlistenScale,
  }),
}));
vi.mock("@crabnebula/tauri-plugin-drag", () => ({ startDrag: mocks.startDrag }));

import {
  Droppable,
  ExplorerDragProvider,
  useExplorerDragSource,
} from "../drag/ExplorerDragContext";

const item: ExplorerDragItem = {
  entryId: "entry",
  name: "photo.jpg",
  path: "/Pictures/photo.jpg",
  isDirectory: false,
  storageId: "local:default",
};

describe("ExplorerDragProvider", () => {
  let container: HTMLDivElement;
  let root: Root;
  let elementAtPoint: Element | null;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.dragListener = null;
    mocks.startDrag.mockClear();
    mocks.cancelPreparation.mockClear();
    mocks.unlistenDrag.mockClear();
    mocks.unlistenScale.mockClear();
    elementAtPoint = null;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    Object.defineProperty(document, "elementsFromPoint", {
      configurable: true,
      value: () => (elementAtPoint ? [elementAtPoint] : []),
    });
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("starts after six pixels and dispatches a pointer drop", async () => {
    const onDrop = vi.fn();
    await renderHarness(onDrop);
    const source = container.querySelector<HTMLElement>("[data-source]")!;
    elementAtPoint = container.querySelector<HTMLElement>("[data-zone]");

    await act(async () => source.dispatchEvent(pointer("pointerdown", 0, 0)));
    await act(async () => window.dispatchEvent(pointer("pointermove", 5, 0)));
    expect(container.textContent).not.toContain("photo.jpg");
    expect(container.querySelector("[data-explorer-drag-interaction-shield]")).toBeNull();
    await act(async () => window.dispatchEvent(pointer("pointermove", 7, 0)));
    expect(container.textContent).toContain("photo.jpg");
    expect(container.querySelector("[data-explorer-drag-interaction-shield]")).not.toBeNull();
    await act(async () => {
      window.dispatchEvent(pointer("pointerup", 7, 0));
      await Promise.resolve();
    });

    expect(onDrop).toHaveBeenCalledWith(
      expect.objectContaining({ origin: "internal", items: [item] }),
      expect.any(Object),
    );
    expect(container.querySelector("[data-explorer-drag-interaction-shield]")).toBeNull();
  });

  it("cancels an active pointer session on Escape", async () => {
    const onDrop = vi.fn();
    await renderHarness(onDrop);
    const source = container.querySelector<HTMLElement>("[data-source]")!;
    elementAtPoint = container.querySelector<HTMLElement>("[data-zone]");
    await act(async () => source.dispatchEvent(pointer("pointerdown", 0, 0)));
    await act(async () => window.dispatchEvent(pointer("pointermove", 8, 0)));
    expect(document.documentElement.dataset.explorerDragging).toBe("true");
    await act(async () =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    await act(async () => window.dispatchEvent(pointer("pointerup", 8, 0)));
    expect(onDrop).not.toHaveBeenCalled();
    expect(document.documentElement.dataset.explorerDragging).toBeUndefined();
  });

  it("always shows the total number of dragged items", async () => {
    const second = { ...item, entryId: "second", name: "second.jpg", path: "/Pictures/second.jpg" };
    await renderHarness(vi.fn(), [item, second]);
    const source = container.querySelector<HTMLElement>("[data-source]")!;
    elementAtPoint = container.querySelector<HTMLElement>("[data-zone]");
    await act(async () => source.dispatchEvent(pointer("pointerdown", 0, 0)));
    await act(async () => window.dispatchEvent(pointer("pointermove", 8, 0)));
    expect(container.querySelector('[role="status"]')?.textContent).toContain("2 items");
    expect(elementAtPoint?.getAttribute("data-explorer-drop-active")).toBe("true");
    expect(elementAtPoint?.hasAttribute("data-explorer-drop-valid")).toBe(false);
    await act(async () =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
  });

  it("preserves dragged items while spring-loading an invalid drop location for navigation", async () => {
    vi.useFakeTimers();
    const onDrop = vi.fn();
    try {
      await act(async () =>
        root.render(
          <ExplorerDragProvider>
            <NavigationHarness onDrop={onDrop} invalidBeforeNavigation />
          </ExplorerDragProvider>,
        ),
      );
      const source = container.querySelector<HTMLElement>("[data-source]")!;
      elementAtPoint = container.querySelector<HTMLElement>("[data-zone]");
      await act(async () => source.dispatchEvent(pointer("pointerdown", 0, 0)));
      await act(async () => window.dispatchEvent(pointer("pointermove", 8, 0)));
      expect(container.querySelector('[role="status"]')?.textContent).not.toContain(
        "Cannot drop here",
      );
      await act(async () => {
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(701);
      });
      expect(container.querySelector("[data-source]")).toBeNull();

      await act(async () => window.dispatchEvent(pointer("lostpointercapture", 8, 0)));
      expect(container.textContent).toContain("photo.jpg");
      await act(async () => {
        window.dispatchEvent(pointer("pointerup", 8, 0));
        await Promise.resolve();
      });
      expect(onDrop).toHaveBeenCalledWith(
        expect.objectContaining({ items: [item] }),
        expect.any(Object),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("converts and dispatches Tauri Finder ingress and disposes listeners", async () => {
    const onDrop = vi.fn();
    await renderHarness(onDrop);
    elementAtPoint = container.querySelector<HTMLElement>("[data-zone]");
    await vi.waitFor(() => expect(mocks.dragListener).not.toBeNull());
    await act(async () =>
      mocks.dragListener?.({
        payload: { type: "enter", paths: ["/tmp/in.txt"], position: { x: 400, y: 200 } },
      }),
    );
    expect(container.querySelector<HTMLElement>('[role="status"]')?.style.left).toBe("214px");
    expect(container.querySelector("[data-explorer-drag-interaction-shield]")).not.toBeNull();
    await act(async () => {
      mocks.dragListener?.({
        payload: { type: "drop", paths: ["/tmp/in.txt"], position: { x: 400, y: 200 } },
      });
      await Promise.resolve();
    });
    expect(onDrop).toHaveBeenCalledWith(
      expect.objectContaining({ origin: "external" }),
      expect.any(Object),
    );
    expect(container.querySelector("[data-explorer-drag-interaction-shield]")).toBeNull();
    await act(async () => root.unmount());
    expect(mocks.unlistenDrag).toHaveBeenCalledOnce();
    expect(mocks.unlistenScale).toHaveBeenCalledOnce();
    root = createRoot(container);
  });

  it("hands a held local drag to the native plugin on webview exit", async () => {
    await renderHarness(vi.fn());
    const source = container.querySelector<HTMLElement>("[data-source]")!;
    await act(async () => source.dispatchEvent(pointer("pointerdown", 0, 0, { shiftKey: true })));
    await act(async () => window.dispatchEvent(pointer("pointermove", 8, 0, { shiftKey: true })));
    await act(async () => {
      window.dispatchEvent(pointer("pointerout", 9, 0, { shiftKey: true }));
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(mocks.startDrag).toHaveBeenCalledOnce());
    expect(mocks.startDrag).toHaveBeenCalledWith(
      expect.objectContaining({ item: [item.path], mode: "move" }),
      expect.any(Function),
    );
  });

  it("cancels remote preparation when the pointer is released before staging finishes", async () => {
    let finishPreparation!: (value: { items: Array<{ localPath: string }>; skipped: [] }) => void;
    mocks.prepareItems.mockReturnValueOnce(
      new Promise((resolve) => {
        finishPreparation = resolve;
      }),
    );
    const remoteItem: ExplorerDragItem = {
      ...item,
      path: "/mnt/misty/work/photo.jpg",
      storageId: "remote:work",
      location: {
        kind: "remote",
        providerType: "drive",
        remoteName: "work",
        remotePath: "/photo.jpg",
      },
    };
    await renderHarness(vi.fn(), [remoteItem]);
    const source = container.querySelector<HTMLElement>("[data-source]")!;
    await act(async () => source.dispatchEvent(pointer("pointerdown", 0, 0)));
    await act(async () => window.dispatchEvent(pointer("pointermove", 8, 0)));
    await act(async () => window.dispatchEvent(pointer("pointerout", 9, 0)));
    await act(async () => window.dispatchEvent(pointer("pointerup", 9, 0)));
    await act(async () => {
      finishPreparation({ items: [{ localPath: "/tmp/photo.jpg" }], skipped: [] });
      await Promise.resolve();
    });
    expect(mocks.cancelPreparation).toHaveBeenCalledOnce();
    expect(mocks.startDrag).not.toHaveBeenCalled();
  });

  async function renderHarness(onDrop: ExplorerDropZoneSpec["onDrop"], items = [item]) {
    const zone: ExplorerDropZoneSpec = {
      id: "target",
      priority: 10,
      accepts: () => ({ valid: true, label: "Copy here" }),
      onDrop,
    };
    await act(async () =>
      root.render(
        <ExplorerDragProvider>
          <Harness zone={zone} items={items} />
        </ExplorerDragProvider>,
      ),
    );
  }
});

function Harness({ zone, items }: { zone: ExplorerDropZoneSpec; items: ExplorerDragItem[] }) {
  const source = useExplorerDragSource(items);
  return (
    <>
      <div data-source onPointerDown={source.onPointerDown}>
        Source
      </div>
      <Droppable data-zone zone={zone}>
        Target
      </Droppable>
    </>
  );
}

function NavigationHarness({
  onDrop,
  invalidBeforeNavigation = false,
}: {
  onDrop: ExplorerDropZoneSpec["onDrop"];
  invalidBeforeNavigation?: boolean;
}) {
  const [sourceVisible, setSourceVisible] = useState(true);
  const source = useExplorerDragSource([item]);
  const zone = useMemo<ExplorerDropZoneSpec>(
    () => ({
      id: "navigation-target",
      priority: 10,
      accepts: () =>
        invalidBeforeNavigation && sourceVisible
          ? { valid: false, label: "Cannot drop here" }
          : { valid: true, label: "Open folder" },
      onDrop,
      springLoad: true,
      onSpringLoad: () => setSourceVisible(false),
    }),
    [invalidBeforeNavigation, onDrop, sourceVisible],
  );
  return (
    <>
      {sourceVisible ? (
        <div data-source onPointerDown={source.onPointerDown}>
          Source
        </div>
      ) : null}
      <Droppable data-zone zone={zone}>
        Target
      </Droppable>
    </>
  );
}

function pointer(type: string, x: number, y: number, init: MouseEventInit = {}): Event {
  const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y, ...init });
  Object.defineProperties(event, { pointerId: { value: 1 }, isPrimary: { value: true } });
  return event;
}
