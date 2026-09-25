import { act, type ReactNode, type ButtonHTMLAttributes } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserSiteInfo } from "./BrowserSiteInfo";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("./useBrowserOverlayControl", async () => {
  const { useState, useCallback } = await import("react");
  return {
    useBrowserOverlayControl: () => {
      const [open, setOpen] = useState(false);
      return { open, onOpenChange: useCallback((value: boolean) => setOpen(value), []) };
    },
  };
});
// Exercise the panel lifecycle without depending on Radix pointer-event internals in jsdom.
vi.mock("@/shared/ui", () => ({
  Button: ({
    variant: _variant,
    size: _size,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }) => (
    <button {...props} />
  ),
  Popover: ({
    open,
    onOpenChange,
    children,
  }: {
    open: boolean;
    onOpenChange: (value: boolean) => void;
    children: ReactNode[];
  }) => (
    <div
      data-open={open}
      onClick={(event) => {
        if (
          (event.target as HTMLElement).closest('[aria-label="Site information and permissions"]')
        )
          onOpenChange(!open);
      }}
    >
      {open ? children : children[0]}
    </div>
  ),
  PopoverTrigger: ({ children }: { children: ReactNode }) => children,
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
const info = {
  url: "https://example.com/page",
  origin: "https://example.com",
  secure: true,
  persistent: true,
  permissions: { camera: "ask", microphone: "ask" },
};

describe("Browser site permissions", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    invoke.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });
  async function open(url = info.url) {
    await act(async () =>
      root.render(<BrowserSiteInfo id="tab-one" url={url} active iconButtonClass="" />),
    );
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  }
  it("uses the native origin when changing one permission and preserves the other", async () => {
    invoke
      .mockResolvedValueOnce(info)
      .mockResolvedValueOnce({ ...info, permissions: { camera: "block", microphone: "ask" } });
    await open();
    const select = container.querySelector<HTMLSelectElement>('[aria-label="Camera permission"]')!;
    await act(async () => {
      select.value = "block";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(invoke).toHaveBeenLastCalledWith("browser_site_permissions_set", {
      id: "tab-one",
      origin: "https://example.com",
      permissions: { camera: "block", microphone: "ask" },
    });
    expect(select.value).toBe("block");
  });
  it("closes on navigation and ignores an old site's pending response", async () => {
    let resolve!: (value: typeof info) => void;
    invoke.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    await open();
    await act(async () =>
      root.render(
        <BrowserSiteInfo id="tab-one" url="https://other.example" active iconButtonClass="" />,
      ),
    );
    await act(async () => resolve(info));
    expect(container.querySelector('[data-open="false"]')).not.toBeNull();
    expect(container.textContent).not.toContain("https://example.com");
  });
  it("keeps the displayed decision unchanged when saving fails", async () => {
    invoke
      .mockResolvedValueOnce(info)
      .mockRejectedValueOnce("The page changed. Reopen site settings and try again.")
      .mockResolvedValueOnce(info);
    await open();
    const select = container.querySelector<HTMLSelectElement>(
      '[aria-label="Microphone permission"]',
    )!;
    await act(async () => {
      select.value = "allow";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("The page changed");
    expect(select.value).toBe("ask");
  });
  it("refreshes a saved policy when stopping capture fails afterward", async () => {
    invoke
      .mockResolvedValueOnce(info)
      .mockRejectedValueOnce(
        "Permission saved, but stopping capture timed out. Close affected tabs.",
      )
      .mockResolvedValueOnce({ ...info, permissions: { camera: "block", microphone: "ask" } });
    await open();
    const select = container.querySelector<HTMLSelectElement>('[aria-label="Camera permission"]')!;
    await act(async () => {
      select.value = "block";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(
      container.querySelector<HTMLSelectElement>('[aria-label="Camera permission"]')?.value,
    ).toBe("block");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Permission saved");
  });
});
