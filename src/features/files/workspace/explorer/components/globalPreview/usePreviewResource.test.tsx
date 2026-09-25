import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { usePreviewResource } from "./usePreviewResource";
import type { PreviewResource } from "../../model/interfaces/components/GlobalPreview";

it("releases a late preview URL after switching files and the visible URL on close", async () => {
  const revoke = vi.fn();
  vi.stubGlobal(
    "URL",
    class extends URL {
      static revokeObjectURL = revoke;
    },
  );
  try {
    let complete!: (resource: PreviewResource) => void;
    const first = new Promise<PreviewResource>((resolve) => {
      complete = resolve;
    });
    const load = vi.fn(async (source: { path: string }) =>
      source.path === "old"
        ? first
        : { kind: "image" as const, url: "blob:visible", mimeType: "image/png" },
    );
    const view = renderHook(({ source }) => usePreviewResource(source, load), {
      initialProps: { source: { path: "old", name: "old" } },
    });
    view.rerender({ source: { path: "current", name: "current" } });
    await waitFor(() => expect(view.result.current.resource?.url).toBe("blob:visible"));
    await act(async () => complete({ kind: "image", url: "blob:late", mimeType: "image/png" }));
    expect(view.result.current.resource?.url).toBe("blob:visible");
    expect(revoke).toHaveBeenCalledWith("blob:late");
    view.unmount();
    expect(revoke).toHaveBeenCalledWith("blob:visible");
  } finally {
    vi.unstubAllGlobals();
  }
});
