import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useBrowserRuntimeStore } from "@/features/webviews/browserRuntime";
import { ContinueHero } from "./ContinueHero";
import { useHomePreviewItems } from "./useHomePreviewItems";
import type { ContinueItem } from "./useContinueItems";

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    disconnect() {}
  },
);
afterEach(() => {
  cleanup();
  useBrowserRuntimeStore.setState({ previews: {} });
});
const first = {
  tab: {
    id: "first",
    surfaceId: "browser",
    title: "First",
    state: { url: "https://example.test/" },
    lastFocusedAt: Date.now(),
  },
  detail: "example.test",
  windowTitle: "Window 1",
  faviconUrl: null,
} as ContinueItem;
const second = {
  ...first,
  tab: {
    ...first.tab,
    id: "second",
    title: "Second",
    state: { url: "https://example.test/other" },
  },
};

beforeEach(() => {
  useBrowserRuntimeStore.setState({
    previews: {
      first: { url: "https://example.test/", dataUrl: "data:image/png;base64,Zmlyc3Q=" },
      second: { url: "https://example.test/other", dataUrl: "data:image/png;base64,c2Vjb25k" },
    },
  });
});

it("renders isolated HTML and changes documents when paging through cards", () => {
  useBrowserRuntimeStore.setState({
    previews: {
      first: {
        url: "https://example.test/",
        document: { width: 1440, height: 900, html: "<h1>First page</h1>" },
      },
      second: { url: "https://example.test/other", dataUrl: "data:image/png;base64,c2Vjb25k" },
    },
  });
  const ui = render(
    <MemoryRouter>
      <ContinueHero items={[first, second]} />
    </MemoryRouter>,
  );
  expect(ui.queryByText("Browser")).toBeNull();
  expect(ui.queryByText("Window 1")).toBeNull();
  expect(ui.queryByText("Page preview")).toBeNull();
  const frame = ui.container.querySelector("iframe")!;
  expect(frame.getAttribute("srcdoc")).toContain("First page");
  expect(frame.getAttribute("sandbox")).toBe("");
  fireEvent.click(ui.getByRole("button", { name: "Next website" }));
  expect(ui.container.querySelector("iframe")).toBeNull();
  expect(ui.container.querySelector("img")?.src).toBe("data:image/png;base64,c2Vjb25k");
  fireEvent.click(ui.getByRole("button", { name: "Previous website" }));
  expect(ui.getByRole("heading", { name: "First" })).toBeTruthy();
});

it("never shows a snapshot from another URL", () => {
  useBrowserRuntimeStore.setState({
    previews: { first: { url: "https://example.test/old", dataUrl: "data:image/png;base64,b2xk" } },
  });
  const ui = render(
    <MemoryRouter>
      <ContinueHero items={[first]} />
    </MemoryRouter>,
  );
  expect(ui.container.querySelector("img,iframe")).toBeNull();
});

it("never shows private content even if a snapshot exists", () => {
  useBrowserRuntimeStore.setState({
    previews: {
      first: {
        url: "https://example.test/",
        document: { html: "<h1>Private content</h1>", width: 1440, height: 900 },
      },
    },
  });
  const privateItem = {
    ...first,
    tab: { ...first.tab, state: { url: "https://example.test/", private: true } },
  };
  const ui = render(
    <MemoryRouter>
      <ContinueHero items={[privateItem]} />
    </MemoryRouter>,
  );
  expect(ui.container.querySelector("img,iframe")).toBeNull();
});

it("skips Misty pages and internal browser pages when paging through previews", () => {
  const home = { ...first, tab: { ...first.tab, id: "home", surfaceId: "home", title: "Home" } };
  const files = {
    ...first,
    tab: { ...first.tab, id: "files", surfaceId: "files", title: "Files" },
  };
  const internal = {
    ...first,
    tab: { ...first.tab, id: "history", title: "History", state: { url: "misty://history" } },
  };
  const ui = render(
    <MemoryRouter>
      <ContinueHero items={[home, files, internal, first, second] as ContinueItem[]} />
    </MemoryRouter>,
  );
  expect(ui.getByRole("heading", { name: "First" })).toBeTruthy();
  expect(ui.getByText("1/2")).toBeTruthy();
  fireEvent.click(ui.getByRole("button", { name: "Next website" }));
  expect(ui.getByRole("heading", { name: "Second" })).toBeTruthy();
  fireEvent.click(ui.getByRole("button", { name: "Next website" }));
  expect(ui.getByRole("heading", { name: "First" })).toBeTruthy();
});

it("shows the website empty state when only Misty pages are open", () => {
  const home = {
    ...first,
    tab: { ...first.tab, surfaceId: "home", title: "Home" },
  } as ContinueItem;
  const ui = render(
    <MemoryRouter>
      <ContinueHero items={[home]} />
    </MemoryRouter>,
  );
  expect(ui.getByText("No page previews yet")).toBeTruthy();
  expect(ui.queryByRole("button", { name: "Resume" })).toBeNull();
});

it("skips missing or empty previews and updates when a visited page capture arrives", () => {
  useBrowserRuntimeStore.setState({
    previews: {
      first: { url: "https://example.test/", document: { html: "", width: 1440, height: 900 } },
    },
  });
  const ui = render(
    <MemoryRouter>
      <ContinueHero items={[first, second]} />
    </MemoryRouter>,
  );
  expect(ui.getByText("No page previews yet")).toBeTruthy();
  expect(ui.queryByRole("button", { name: "Resume" })).toBeNull();
  act(() =>
    useBrowserRuntimeStore.setState({
      previews: {
        second: { url: "https://example.test/other", dataUrl: "data:image/png;base64,c2Vjb25k" },
      },
    }),
  );
  expect(ui.getByRole("heading", { name: "Second" })).toBeTruthy();
  expect(ui.getByRole("button", { name: "Next website" }).hasAttribute("disabled")).toBe(true);
  expect(ui.getByRole("button", { name: "Previous website" }).hasAttribute("disabled")).toBe(true);
  expect(ui.getByText("1/1")).toBeTruthy();
});

it("removes a broken preview and displays the next cached page", () => {
  const ui = render(
    <MemoryRouter>
      <ContinueHero items={[first, second]} />
    </MemoryRouter>,
  );
  fireEvent.error(ui.container.querySelector("img")!);
  expect(ui.getByRole("heading", { name: "Second" })).toBeTruthy();
  expect(ui.getByRole("button", { name: "Next website" }).hasAttribute("disabled")).toBe(true);
  expect(ui.getByRole("button", { name: "Previous website" }).hasAttribute("disabled")).toBe(true);
  expect(ui.getByText("1/1")).toBeTruthy();
});

it("applies the card limit after checking for cached content", () => {
  const missing = Array.from({ length: 6 }, (_, index) => ({
    ...first,
    tab: { ...first.tab, id: `missing-${index}` },
  }));
  function Selection() {
    const items = useHomePreviewItems([...missing, first, second], 1);
    return <span>{items.map((item) => item.tab.title).join(",")}</span>;
  }
  const ui = render(<Selection />);
  expect(ui.getByText("First")).toBeTruthy();
});
