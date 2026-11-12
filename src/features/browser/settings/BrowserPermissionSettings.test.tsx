import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as SitePermissionModule from "@/features/browser/sitePermissions";
import { NoticeViewport } from "@/shared/ui";
import { BrowserPermissionSettings } from "./BrowserPermissionSettings";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@/features/browser/sitePermissions", async (original) => ({
  ...(await original<typeof SitePermissionModule>()),
  supportsSitePermissions: () => true,
}));
const entry = {
  origin: "https://example.com",
  profile: "profile-a",
  permissions: { camera: "block", microphone: "ask", location: "ask" },
  space: "Work",
};
describe("saved website permissions", () => {
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
  it("resets exactly the selected Space's choice and removes it", async () => {
    invoke
      .mockResolvedValueOnce([entry])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([]);
    await act(async () => root.render(<BrowserPermissionSettings />));
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Reset permissions for https://example.com"]',
        )!
        .click(),
    );
    expect(invoke).toHaveBeenCalledWith("browser_site_permissions_reset", {
      profile: "profile-a",
      origin: "https://example.com",
    });
    expect(container.querySelector('[aria-label="Permissions"]')).toBeNull();
    expect(document.body.querySelector('[role="alert"]')).toBeNull();
  });
  it("reconciles a persisted reset if stopping capture subsequently fails", async () => {
    invoke
      .mockResolvedValueOnce([entry])
      .mockRejectedValueOnce("Permission saved, but stopping capture timed out.")
      .mockResolvedValueOnce([]);
    await act(async () =>
      root.render(
        <>
          <NoticeViewport />
          <BrowserPermissionSettings />
        </>,
      ),
    );
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Reset permissions for https://example.com"]',
        )!
        .click(),
    );
    expect(
      container.querySelector('button[aria-label="Reset permissions for https://example.com"]'),
    ).toBeNull();
    // Failures show in plain language, never the native error text.
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain(
      "Site permissions could not be reset.",
    );
    expect(document.body.querySelector('[role="alert"]')?.textContent).not.toContain("timed out");
    expect(container.textContent).not.toContain("Camera: Block");
  });
});
