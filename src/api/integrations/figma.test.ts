import { spaceRequest } from "@/api/spaces/api";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { figmaDrawingsApi, parseFigmaFileKey } from "./figma";

vi.mock("@/api/spaces/api", () => ({ spaceRequest: vi.fn() }));

describe("figmaDrawingsApi", () => {
  beforeEach(() => vi.mocked(spaceRequest).mockReset());

  it("uses the frozen Drawings binding, webhook, context, and comment routes", async () => {
    vi.mocked(spaceRequest).mockResolvedValue({});
    await figmaDrawingsApi.bind("space one", {
      connection_id: "connection-1",
      resource_type: "file",
      file_key: "Abc_def-123",
    });
    await figmaDrawingsApi.reconcileWebhooks("space one", "binding/one");
    await figmaDrawingsApi.context("space one", "binding/one", "Abc_def-123");
    await figmaDrawingsApi.comment("space one", "binding/one", {
      file_key: "Abc_def-123",
      message: "Looks ready",
      confirmed: true,
      idempotency_key: "comment-once-1",
    });

    expect(spaceRequest).toHaveBeenNthCalledWith(
      1,
      "/spaces/space%20one/drawings/figma/bindings",
      expect.objectContaining({ method: "POST" }),
    );
    expect(spaceRequest).toHaveBeenNthCalledWith(
      2,
      "/spaces/space%20one/drawings/figma/bindings/binding%2Fone/reconcile-webhooks",
      { method: "POST" },
    );
    expect(spaceRequest).toHaveBeenNthCalledWith(
      3,
      "/spaces/space%20one/drawings/figma/bindings/binding%2Fone/context?file_key=Abc_def-123",
    );
    expect(spaceRequest).toHaveBeenNthCalledWith(
      4,
      "/spaces/space%20one/drawings/figma/bindings/binding%2Fone/comments",
      {
        method: "POST",
        body: JSON.stringify({
          file_key: "Abc_def-123",
          message: "Looks ready",
          confirmed: true,
          idempotency_key: "comment-once-1",
        }),
      },
    );
  });
});

describe("parseFigmaFileKey", () => {
  it.each([
    ["Abc_def-123", "Abc_def-123"],
    ["https://www.figma.com/file/Abc_def-123/Launch", "Abc_def-123"],
    ["https://figma.com/design/Abc_def-123/Launch", "Abc_def-123"],
    ["https://www.figma.com/board/Abc_def-123/Workshop", "Abc_def-123"],
  ])("accepts canonical file input %s", (value, expected) => {
    expect(parseFigmaFileKey(value)).toBe(expected);
  });

  it.each([
    "http://www.figma.com/file/Abc_def-123",
    "https://figma.example/file/Abc_def-123",
    "https://evil.figma.com/file/Abc_def-123",
    "https://user:secret@figma.com/file/Abc_def-123",
    "https://www.figma.com/file/Abc%2Fdef-123/Launch",
    "https://www.figma.com/file/../../Abc_def-123",
    "https://www.figma.com/community/Abc_def-123",
    "https://www.figma.com/sneaky/design/Abc_def-123",
  ])("rejects unsafe or non-file input %s", (value) => {
    expect(parseFigmaFileKey(value)).toBe("");
  });
});
