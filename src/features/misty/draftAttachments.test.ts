import { beforeEach, expect, it, vi } from "vitest";
import {
  resetMistyDraftAttachments,
  readMistyDraftAttachments,
  updateMistyDraftAttachments,
  useMistyDraftAttachments,
} from "./draftAttachments";
import type { MistyImageAttachment } from "@/features/global-search/types";
const image: MistyImageAttachment = {
  id: "image",
  name: "drawing.png",
  mimeType: "image/png",
  byteSize: 10,
  width: 1,
  height: 1,
  previewUrl: "blob:preview",
  state: "ready",
};
beforeEach(() => {
  vi.stubGlobal("URL", { revokeObjectURL: vi.fn() });
  useMistyDraftAttachments.setState({ accountId: "", generation: 0, drafts: {} });
});
it("shares an unsent upload across surfaces but isolates conversations", () => {
  resetMistyDraftAttachments("a");
  updateMistyDraftAttachments("a", "conversation", () => [image]);
  expect(readMistyDraftAttachments("a", "conversation")).toEqual([image]);
  expect(readMistyDraftAttachments("a", "other")).toEqual([]);
  expect(readMistyDraftAttachments("b", "conversation")).toEqual([]);
});
it("rejects upload completions after switching away and back to the account", () => {
  resetMistyDraftAttachments("a");
  const generation = useMistyDraftAttachments.getState().generation;
  updateMistyDraftAttachments("a", "c", () => [image]);
  resetMistyDraftAttachments("b");
  resetMistyDraftAttachments("a");
  updateMistyDraftAttachments("a", "c", () => [image], generation);
  expect(readMistyDraftAttachments("a", "c")).toEqual([]);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
});
