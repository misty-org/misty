import { describe, expect, it } from "vitest";
import { aiSafeTurnInput } from "../globalMistyApi";

describe("aiSafeTurnInput", () => {
  it("never serializes a local device path", () => {
    const input = aiSafeTurnInput({
      mode: "ask",
      prompt: "Summarize this",
      context: [
        {
          id: "file-1",
          kind: "file",
          title: "private.txt",
          source: "current",
          localPath: "/Users/example/Secret/private.txt",
          attached: false,
        },
      ],
    });

    expect(JSON.stringify(input)).not.toContain("/Users/example");
    expect(input.context).toEqual([
      expect.objectContaining({ id: "file-1", title: "private.txt", attached: false }),
    ]);
  });
});
