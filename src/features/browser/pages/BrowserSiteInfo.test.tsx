import { fireEvent, screen } from "@testing-library/react";
import { act, type ReactNode, type ButtonHTMLAttributes } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserSiteInfo } from "./BrowserSiteInfo";
import {
  sitePermissionAskText,
  useSitePermissionAsks,
} from "@/features/browser/sitePermissionAsks";
import type * as UiModule from "@/shared/ui";
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
vi.mock("@/shared/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof UiModule>()),
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
  permissions: { camera: "ask", microphone: "ask", location: "ask" },
};

describe("Browser site permissions", () => {
  let container: HTMLDivElement;
  let root: Root;
  const scrollIntoView = HTMLElement.prototype.scrollIntoView;
  beforeEach(() => {
    invoke.mockReset();
    useSitePermissionAsks.setState({ asks: [] });
    HTMLElement.prototype.scrollIntoView = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
  });
  async function open(url = info.url) {
    await act(async () => root.render(<BrowserSiteInfo id="tab-one" url={url} active />));
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  }
  const ask = {
    requestId: 7,
    id: "tab-one",
    origin: "https://example.com",
    topOrigin: "https://example.com",
    kinds: ["location" as const],
  };
  async function asked(url = "https://example.com/search") {
    invoke.mockResolvedValue(info);
    await act(async () => useSitePermissionAsks.setState({ asks: [ask] }));
    await act(async () => root.render(<BrowserSiteInfo id="tab-one" url={url} active />));
  }
  it("opens by itself to ask, and Allow answers and closes it", async () => {
    await asked();
    expect(screen.getByText("example.com wants to use your location")).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Allow" })));
    expect(invoke).toHaveBeenCalledWith("browser_site_permission_answer", {
      requestId: 7,
      decision: "allow",
    });
    expect(useSitePermissionAsks.getState().asks).toEqual([]);
    expect(screen.queryByText("example.com wants to use your location")).toBeNull();
  });
  it("Block answers with a block", async () => {
    await asked();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Block" })));
    expect(invoke).toHaveBeenCalledWith("browser_site_permission_answer", {
      requestId: 7,
      decision: "block",
    });
  });
  it("closing without an answer refuses this time and saves nothing", async () => {
    await asked();
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Site information and permissions"]')!
        .click(),
    );
    expect(invoke).toHaveBeenCalledWith("browser_site_permission_answer", {
      requestId: 7,
      decision: "ask",
    });
  });
  it("a page changing its address keeps asking, and leaving the site ends the question", async () => {
    await asked();
    await act(async () =>
      root.render(<BrowserSiteInfo id="tab-one" url="https://example.com/other" active />),
    );
    expect(screen.getByText("example.com wants to use your location")).toBeTruthy();
    expect(invoke).not.toHaveBeenCalledWith("browser_site_permission_answer", expect.anything());
    await act(async () =>
      root.render(<BrowserSiteInfo id="tab-one" url="https://elsewhere.example/" active />),
    );
    expect(invoke).toHaveBeenCalledWith("browser_site_permission_answer", {
      requestId: 7,
      decision: "ask",
    });
  });
  it("a background tab waits and asks once it is shown", async () => {
    invoke.mockResolvedValue(info);
    await act(async () => useSitePermissionAsks.setState({ asks: [ask] }));
    await act(async () =>
      root.render(<BrowserSiteInfo id="tab-one" url="https://example.com/" active={false} />),
    );
    expect(screen.queryByText("example.com wants to use your location")).toBeNull();
    await act(async () =>
      root.render(<BrowserSiteInfo id="tab-one" url="https://example.com/" active />),
    );
    expect(screen.getByText("example.com wants to use your location")).toBeTruthy();
  });
  it("names both when a call asks for camera and microphone", () => {
    expect(sitePermissionAskText({ ...ask, kinds: ["camera", "microphone"] })).toBe(
      "example.com wants to use your camera and microphone",
    );
  });
  it("says so when macOS blocks location for Misty", async () => {
    invoke.mockResolvedValue({ ...info, locationBlocked: true });
    await open();
    expect(screen.getByText(/macOS is blocking location for Misty/)).toBeTruthy();
  });
  async function choosePermission(kind: "Camera" | "Microphone" | "Location", choice: string) {
    await act(async () => {
      fireEvent.keyDown(screen.getByRole("combobox", { name: `${kind} permission` }), {
        key: "ArrowDown",
      });
    });
    await act(async () => fireEvent.click(screen.getByRole("option", { name: choice })));
  }
  it("uses the native origin when changing one permission and preserves the other", async () => {
    invoke.mockResolvedValueOnce(info).mockResolvedValueOnce({
      ...info,
      permissions: { camera: "block", microphone: "ask", location: "ask" },
    });
    await open();
    await choosePermission("Camera", "Block");
    expect(invoke).toHaveBeenLastCalledWith("browser_site_permissions_set", {
      id: "tab-one",
      origin: "https://example.com",
      permissions: { camera: "block", microphone: "ask", location: "ask" },
    });
    expect(screen.getByRole("combobox", { name: "Camera permission" }).textContent).toContain(
      "Block",
    );
  });
  it("lets a site use the device's location", async () => {
    invoke.mockResolvedValueOnce(info).mockResolvedValueOnce({
      ...info,
      permissions: { camera: "ask", microphone: "ask", location: "allow" },
    });
    await open();
    await choosePermission("Location", "Allow");
    expect(invoke).toHaveBeenLastCalledWith("browser_site_permissions_set", {
      id: "tab-one",
      origin: "https://example.com",
      permissions: { camera: "ask", microphone: "ask", location: "allow" },
    });
    expect(screen.getByRole("combobox", { name: "Location permission" }).textContent).toContain(
      "Allow",
    );
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
      root.render(<BrowserSiteInfo id="tab-one" url="https://other.example" active />),
    );
    await act(async () => resolve(info));
    expect(container.querySelector('[data-open="false"]')).not.toBeNull();
    expect(container.textContent).not.toContain("https://example.com");
  });
  it("allows temporary camera and microphone choices and resets them to Ask", async () => {
    const temporary = { ...info, persistent: false };
    invoke
      .mockResolvedValueOnce(temporary)
      .mockResolvedValueOnce({
        ...temporary,
        permissions: { camera: "block", microphone: "ask", location: "ask" },
      })
      .mockResolvedValueOnce({
        ...temporary,
        permissions: { camera: "block", microphone: "allow", location: "ask" },
      })
      .mockResolvedValueOnce(temporary);
    await open();
    const reset = screen.getByRole<HTMLButtonElement>("button", { name: "Reset permissions" });
    expect(reset.disabled).toBe(true);
    await choosePermission("Camera", "Block");
    expect(reset.disabled).toBe(false);
    await choosePermission("Microphone", "Allow");
    expect(invoke).toHaveBeenLastCalledWith("browser_site_permissions_set", {
      id: "tab-one",
      origin: temporary.origin,
      permissions: { camera: "block", microphone: "allow", location: "ask" },
    });
    expect(container.textContent).toContain("Permissions apply only to this temporary session.");
    await act(async () => fireEvent.click(reset));
    expect(invoke).toHaveBeenLastCalledWith("browser_site_permissions_set", {
      id: "tab-one",
      origin: temporary.origin,
      permissions: { camera: "ask", microphone: "ask", location: "ask" },
    });
    expect(reset.disabled).toBe(true);
  });
  it("keeps the displayed decision unchanged when saving fails", async () => {
    invoke
      .mockResolvedValueOnce(info)
      .mockRejectedValueOnce("The page changed. Reopen site settings and try again.")
      .mockResolvedValueOnce(info);
    await open();
    await choosePermission("Microphone", "Allow");
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain(
      "The page changed",
    );
    expect(screen.getByRole("combobox", { name: "Microphone permission" }).textContent).toContain(
      "Ask",
    );
  });
  it("refreshes a saved policy when stopping capture fails afterward", async () => {
    invoke
      .mockResolvedValueOnce(info)
      .mockRejectedValueOnce(
        "Permission saved, but stopping capture timed out. Close affected tabs.",
      )
      .mockResolvedValueOnce({
        ...info,
        permissions: { camera: "block", microphone: "ask", location: "ask" },
      });
    await open();
    await choosePermission("Camera", "Block");
    expect(screen.getByRole("combobox", { name: "Camera permission" }).textContent).toContain(
      "Block",
    );
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain(
      "Permission saved",
    );
  });
});
