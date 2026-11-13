import { describe, expect, it } from "vitest";
import type { GlobalAiMessage } from "../conversations/state/conversationTypes";
import { chosenByDefault, planFiles, removedRunIds, type RewindFiles } from "./turnFiles";

const message = (
  id: string,
  role: "user" | "assistant",
  invocationId?: string,
): GlobalAiMessage => ({
  id,
  role,
  mode: "ask",
  content: id,
  createdAt: "2026-11-11T00:00:00Z",
  invocationId,
});

const plan: RewindFiles = {
  incomplete: false,
  folders: [
    {
      folder: "/work/app",
      files: [
        { path: "src/a.ts", change: "restore", changedByYou: false },
        { path: "src/b.ts", change: "restore", changedByYou: true },
      ],
    },
    { folder: "/work/docs", files: [{ path: "new.md", change: "remove", changedByYou: false }] },
  ],
};

describe("turn files", () => {
  it("names the runs of the turns a rewind removes, oldest first", () => {
    const messages = [
      message("u1", "user"),
      message("a1", "assistant", "run-1"),
      message("u2", "user"),
      message("a2", "assistant", "run-2"),
      message("u3", "user"),
      message("a3", "assistant", "run-3"),
      message("a3b", "assistant", "run-3"),
    ];
    expect(removedRunIds(messages, 2)).toEqual(["run-2", "run-3"]);
    expect(removedRunIds(messages, 0)).toEqual(["run-1", "run-2", "run-3"]);
    expect(removedRunIds(messages, -1)).toEqual([]);
    expect(removedRunIds(messages, 7)).toEqual([]);
  });

  it("chooses the agent's own files and leaves the person's for them to tick", () => {
    expect(chosenByDefault(plan)).toEqual([
      { folder: "/work/app", path: "src/a.ts" },
      { folder: "/work/docs", path: "new.md" },
    ]);
    expect(planFiles(plan).map((file) => `${file.folder}:${file.path}`)).toEqual([
      "/work/app:src/a.ts",
      "/work/app:src/b.ts",
      "/work/docs:new.md",
    ]);
  });
});
