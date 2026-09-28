import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useBrowserRuntimeStore } from "@/features/webviews/browserRuntime";
import { ContinueHero } from "./ContinueHero";
import { useHomePreviewItems } from "./useHomePreviewItems";
import { usePrepareHomePreviews } from "./usePrepareHomePreviews";
import type { ContinueItem } from "./useContinueItems";

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => true }));
const item = {
  tab: {
    id: "restore-preview",
    instanceKey: "restore-preview",
    surfaceId: "browser",
    title: "Open website",
    state: { url: "https://example.test/" },
    lastFocusedAt: Date.now(),
  },
  detail: "example.test",
  windowTitle: "",
  faviconUrl: null,
} as ContinueItem;
const items = [item];
const capture = { url: "https://example.test/", dataUrl: "data:image/png;base64,cHJldmlldw==" };

function Home({ candidates = items, active = true }) {
  const preparing = usePrepareHomePreviews(candidates, active, 4);
  const previews = useHomePreviewItems(candidates, 4);
  return <ContinueHero items={previews} preparing={preparing} />;
}

beforeEach(() => {
  useBrowserRuntimeStore.setState({ previews: {}, loading: {} });
  native.invoke
    .mockReset()
    .mockImplementation(async (command) =>
      command === "browser_webview_preview_document" ? capture : undefined,
    );
});
afterEach(cleanup);

it("fills an empty Home cache from restored browser tabs without visiting them", async () => {
  let finish!: (value: typeof capture) => void;
  native.invoke.mockImplementation(async (command) => {
    if (command === "browser_webview_preview_document")
      return new Promise((resolve) => {
        finish = resolve;
      });
  });
  render(<Home />);
  expect(screen.getByRole("status").textContent).toBe("Preparing page previews…");
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    finish(capture);
  });
  expect(await screen.findByRole("heading", { name: "Open website" })).toBeTruthy();
  expect(native.invoke).toHaveBeenCalledWith("browser_webview_create", {
    request: expect.objectContaining({ previewOnly: true, x: 100_000 }),
  });
  expect(native.invoke).toHaveBeenCalledWith("browser_webview_close", {
    request: { id: expect.stringMatching(/^preview-/) },
  });
});

it("keeps cached previews without recapturing", () => {
  useBrowserRuntimeStore.setState({ previews: { [item.tab.id]: capture } });
  render(<Home />);
  expect(screen.getByRole("heading", { name: "Open website" })).toBeTruthy();
  expect(native.invoke).not.toHaveBeenCalled();
});

it("does not prepare hidden Home pages or private websites", () => {
  const ui = render(<Home active={false} />);
  expect(native.invoke).not.toHaveBeenCalled();
  ui.rerender(
    <Home
      candidates={[
        {
          ...item,
          tab: { ...item.tab, state: { url: "https://example.test/", private: true } },
        },
      ]}
    />,
  );
  expect(native.invoke).not.toHaveBeenCalled();
  expect(screen.getByText("No page previews yet")).toBeTruthy();
});

it("discards a late capture when Home is left and closes the temporary view", async () => {
  let finish!: (value: typeof capture) => void;
  native.invoke.mockImplementation(async (command) => {
    if (command === "browser_webview_preview_document")
      return new Promise((resolve) => {
        finish = resolve;
      });
  });
  const ui = render(<Home />);
  await act(async () => {
    await Promise.resolve();
  });
  ui.unmount();
  await act(async () => {
    finish(capture);
  });
  expect(useBrowserRuntimeStore.getState().previews).toEqual({});
  expect(native.invoke).toHaveBeenCalledWith("browser_webview_close", {
    request: { id: expect.stringMatching(/^preview-/) },
  });
});
