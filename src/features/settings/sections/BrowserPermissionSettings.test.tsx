import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as SitePermissionModule from "@/features/browser-workspace/sitePermissions";
import { BrowserPermissionSettings } from "./BrowserPermissionSettings";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@/features/browser-workspace/sitePermissions", async (original) => ({
  ...(await original<typeof SitePermissionModule>()),
  supportsSitePermissions: () => true,
}));
const entry = {
  origin: "https://example.com",
  profile: "profile-a",
  permissions: { camera: "block", microphone: "ask" },
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
  it("resets exactly the selected profile and removes the saved choice", async () => {
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
    expect(container.textContent).toContain("No saved choices");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
  it("reconciles a persisted reset if stopping capture subsequently fails", async () => {
    invoke
      .mockResolvedValueOnce([entry])
      .mockRejectedValueOnce("Permission saved, but stopping capture timed out.")
      .mockResolvedValueOnce([]);
    await act(async () => root.render(<BrowserPermissionSettings />));
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
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "stopping capture timed out",
    );
    expect(container.textContent).not.toContain("Camera: Block");
  });
});
