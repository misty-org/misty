import { expect, it, vi } from "vitest";
import type { MistyAiArtifact, MistyBrowserSDK, MistyBrowserInspection } from "@misty/sdk";
import { sdkBrowserSurface } from "./sdkBrowserSurface";
it("binds proposed actions to an inspected document and opaque tab context", async () => {
  const click = vi.fn(async () => {}),
    navigate = vi.fn(async () => {}),
    applied = vi.fn();
  const page: MistyBrowserInspection = {
    documentId: crypto.randomUUID(),
    url: "https://example.com",
    title: "Page",
    text: "Untrusted page",
    truncated: false,
    interactive: [{ ref: "element-1", tag: "button", role: "", name: "Open" }],
    contentTrust: "untrusted-web-page",
  };
  const surface = sdkBrowserSurface({
    browser: { click, navigate } as unknown as MistyBrowserSDK,
    instanceId: "tab",
    handle: "handle",
    contextId: "context",
    page,
    applied,
  });
  const artifact = {
    kind: "browser_action",
    baseRevision: page.documentId,
    operations: { tab_scope_id: "context", steps: [{ action: "click", target: "element-1" }] },
  } as MistyAiArtifact;
  expect(surface.getContext()[0]).toMatchObject({ opaqueScopeId: "context", attached: true });
  expect(surface.getSelection?.()?.anchors?.contentTrust).toBe("untrusted-web-page");
  for (const patch of [
    { baseRevision: crypto.randomUUID() },
    { operations: { tab_scope_id: "other", steps: [{ action: "click", target: "element-1" }] } },
    { operations: { tab_scope_id: "context", steps: [{ action: "click", target: "unlisted" }] } },
    {
      operations: {
        tab_scope_id: "context",
        steps: [{ action: "navigate", value: "file:///private" }],
      },
    },
  ])
    expect(surface.canApply?.({ ...artifact, ...patch })).toBe(false);
  await surface.applyArtifact?.(artifact);
  expect(click).toHaveBeenCalledExactlyOnceWith("handle", page.documentId, "element-1");
  expect(applied).toHaveBeenCalledOnce();
});
