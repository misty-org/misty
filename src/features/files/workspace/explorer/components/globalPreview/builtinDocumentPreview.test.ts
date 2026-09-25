import { expect, it, vi } from "vitest";
import { loadGlobalPreview } from "./useGlobalPreviewResource";
const preview = vi.hoisted(() => vi.fn());
vi.mock("@/features/files/workspace/native", () => ({ explorerPreviewItem: preview }));
it("reads office documents with the built-in reader without a mounted Files package", async () => {
  preview.mockResolvedValue({
    bytes: [...new TextEncoder().encode("{\\rtf1 Built-in preview}")],
    mimeType: "application/rtf",
  });
  const result = await loadGlobalPreview({ path: "/sample.rtf", name: "sample.rtf" });
  expect(result.kind).toBe("document");
  expect(result.text).toContain("Built-in preview");
});
