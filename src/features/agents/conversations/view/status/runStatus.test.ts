import { describe, expect, it } from "vitest";
import type { GlobalAiMessage } from "../../state/conversationTypes";
import { createEditedFilesBuilder, latestReply, liveStep } from "./runStatus";

const reply = (fields: Partial<GlobalAiMessage>): GlobalAiMessage => ({
  id: "a",
  role: "assistant",
  mode: "ask",
  content: "",
  createdAt: "2026-11-11T00:00:00Z",
  ...fields,
});

describe("run status", () => {
  it("names the running step of a live reply", () => {
    const message = reply({
      state: "streaming",
      progress: [
        { type: "tool", id: "1", name: "web_search", state: "completed" },
        { type: "tool", id: "2", name: "Read", state: "running", path: "src/a.ts" },
      ],
    });
    expect(liveStep(latestReply([message]))).toBe("Reading src/a.ts");
    expect(liveStep(reply({ state: "completed" }))).toBeUndefined();
  });

  it("lists edited files once with their summed counts", () => {
    const build = createEditedFilesBuilder();
    const messages = [
      reply({
        progress: [
          {
            type: "tool",
            id: "1",
            name: "Edit",
            state: "completed",
            args: { file_path: "a.ts", old_string: "x", new_string: "y\nz" },
          },
          {
            type: "tool",
            id: "2",
            name: "Write",
            state: "completed",
            args: { file_path: "b.ts", content: "1\n2\n3" },
          },
          {
            type: "tool",
            id: "3",
            name: "Edit",
            state: "completed",
            args: { file_path: "a.ts", old_string: "q", new_string: "" },
          },
          { type: "tool", id: "4", name: "Read", state: "completed", args: { file_path: "c.ts" } },
        ],
      }),
    ];
    const { files, total } = build(messages);
    expect(files).toEqual([
      { path: "a.ts", stat: { additions: 2, deletions: 2 } },
      { path: "b.ts", stat: { additions: 3, deletions: 0 } },
    ]);
    expect(total).toEqual({ additions: 5, deletions: 2 });
  });
});
