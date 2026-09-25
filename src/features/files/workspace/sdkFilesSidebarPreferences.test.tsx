import { act, renderHook } from "@testing-library/react";
import { createMistyAppSDK } from "@misty/sdk";
import { expect, it, vi } from "vitest";
import { createSdkFilesSidebarPreferences } from "./sdkFilesSidebarPreferences";

it("restores and persists the existing sidebar preferences through owned SDK storage", async () => {
  let saved: unknown = {
    collapsedSections: { devices: true },
    hiddenQuickAccessPaths: ["chosen/folder"],
  };
  const request = vi.fn(async ({ method, params }: { method: string; params?: unknown }) => {
    if (method === "lifecycle.ready") return;
    if (method === "storage.local.get") return saved;
    if (method === "storage.local.set") {
      saved = structuredClone((params as { value: unknown }).value);
      return;
    }
    throw new Error(`Unexpected storage method ${method}`);
  });
  const misty = createMistyAppSDK({ request }),
    lifetime = new AbortController(),
    report = vi.fn();
  const first = await createSdkFilesSidebarPreferences(misty, lifetime.signal, report);
  const view = renderHook(first.useSidebarPreferences);
  expect(view.result.current.collapsedSections.devices).toBe(true);
  act(() => {
    view.result.current.toggleSection("quickAccess");
    view.result.current.setHiddenQuickAccessPaths((paths) => [...paths, "chosen/second"]);
  });
  await first.flush();
  view.unmount();
  await first.close();
  const restored = await createSdkFilesSidebarPreferences(misty, lifetime.signal, report);
  const reopened = renderHook(restored.useSidebarPreferences);
  expect(reopened.result.current.collapsedSections.quickAccess).toBe(true);
  expect(reopened.result.current.hiddenQuickAccessPaths).toEqual([
    "chosen/folder",
    "chosen/second",
  ]);
  lifetime.abort();
  expect(() => reopened.result.current.toggleSection("devices")).toThrow("closed");
  reopened.unmount();
  await restored.close();
  expect(report).not.toHaveBeenCalled();
});
