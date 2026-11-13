// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { describe, expect, it, vi } from "vitest";
import {
  computeDiffLines,
  countEditLines,
  createEditLineStatsBuilder,
  isEditToolName,
  type EditToolCall,
} from "./editLineStats";

function editRow(_seq: number, path: string, args: unknown, name = "Edit"): EditToolCall {
  return { name, path, args };
}

describe("countEditLines", () => {
  it("counts +/- rows of a unified patch", () => {
    const stat = countEditLines({
      file_path: "src/a.ts",
      patch: "@@ -1,4 +1,5 @@\n ctx\n-gone\n-also gone\n+fresh\n+more\n+tail\n ctx2",
    });
    expect(stat).toEqual({ additions: 3, deletions: 2 });
  });

  it("counts the changed span of an old/new string pair, ignoring common context", () => {
    const stat = countEditLines({
      old_string: "keep\nold one\nold two\ntail",
      new_string: "keep\nnew one\ntail",
    });
    expect(stat).toEqual({ additions: 1, deletions: 2 });
  });

  it("counts a whole-file content write as pure additions", () => {
    expect(countEditLines({ path: "src/new.ts", content: "a\nb\nc" })).toEqual({
      additions: 3,
      deletions: 0,
    });
  });

  it("prefers the patch over the string pair, matching the diff viewer", () => {
    const stat = countEditLines({
      patch: "@@ -1 +1 @@\n-x\n+y",
      old_string: "1\n2\n3\n4\n5",
      new_string: "",
    });
    expect(stat).toEqual({ additions: 1, deletions: 1 });
  });

  it("returns null when the args carry no edit payload", () => {
    expect(countEditLines({ file_path: "src/a.ts", offset: 10 })).toBeNull();
    expect(countEditLines(undefined)).toBeNull();
    expect(countEditLines("edit src/a.ts")).toBeNull();
  });
});

describe("deriveEditLineStats", () => {
  it("reuses unchanged tool statistics and aggregate identity during streaming", () => {
    const build = createEditLineStatsBuilder();
    const readContent = vi.fn(() => "a\nb");
    const tool = editRow(1, "src/a.ts", {
      get content() {
        return readContent();
      },
    });
    const first = build([tool]);
    const reads = readContent.mock.calls.length;
    expect(reads).toBeGreaterThan(0);
    expect(build([tool, { name: "Read", path: "src/a.ts" }])).toBe(first);
    expect(readContent).toHaveBeenCalledTimes(reads);
    expect(build([tool, editRow(3, "src/a.ts", { content: "c" })]).get("src/a.ts")).toEqual({
      additions: 3,
      deletions: 0,
    });
    expect(readContent).toHaveBeenCalledTimes(reads);
    expect(first.get("src/a.ts")).toEqual({ additions: 2, deletions: 0 });
  });

  it("invalidates replaced messages, prepended history and removed tools without sharing sessions", () => {
    const build = createEditLineStatsBuilder();
    const tool = editRow(1, "a.ts", { content: "a" });
    const first = build([tool]);
    expect(build([{ ...tool, args: { content: "a\nb" } }]).get("a.ts")?.additions).toBe(2);
    expect(build([editRow(0, "b.ts", { content: "old" }), tool]).size).toBe(2);
    expect(build([]).size).toBe(0);
    expect(
      createEditLineStatsBuilder()([editRow(1, "a.ts", { content: "other\nsession" })]).get("a.ts")
        ?.additions,
    ).toBe(2);
    expect(first.get("a.ts")?.additions).toBe(1);
  });
});

describe("large edit payloads", () => {
  it("keeps suffix order without quadratic array prepends", () => {
    const suffix = Array.from({ length: 2000 }, (_, index) => `line ${index}`).join("\n");
    const prepend = vi.spyOn(Array.prototype, "unshift");
    let lines: ReturnType<typeof computeDiffLines>;
    let prepends: number;
    try {
      lines = computeDiffLines(`old\n${suffix}`, `new\n${suffix}`);
      prepends = prepend.mock.calls.length;
    } finally {
      prepend.mockRestore();
    }
    expect(prepends).toBe(0);
    expect(lines!.slice(0, 3)).toEqual([
      { type: "del", text: "old", oldLineNo: 1 },
      { type: "add", text: "new", newLineNo: 1 },
      { type: "ctx", text: "line 0", oldLineNo: 2, newLineNo: 2 },
    ]);
    expect(lines!.slice(-1)[0]).toEqual({
      type: "ctx",
      text: "line 1999",
      oldLineNo: 2001,
      newLineNo: 2001,
    });
  });

  it("matches the displayed diff counts for empty, Unicode, prefix and suffix cases", () => {
    const inputs = [undefined, "", "text🙂", "a\n", "a\nb", "x\na\nb", "a\nb\nx"];
    for (const oldString of inputs) {
      for (const newString of inputs) {
        if (!oldString && !newString) continue;
        const lines = computeDiffLines(oldString, newString);
        expect(countEditLines({ old_string: oldString, new_string: newString })).toEqual({
          additions: lines.filter((line) => line.type === "add").length,
          deletions: lines.filter((line) => line.type === "del").length,
        });
      }
    }
  });
});

describe("isEditToolName", () => {
  it("knows edit tools under any prefix", () => {
    for (const name of [
      "Edit",
      "Write",
      "MultiEdit",
      "apply_patch",
      "mcp__misty__file_write",
      "fs.edit_file",
    ])
      expect(isEditToolName(name)).toBe(true);
    for (const name of ["Read", "Bash", "web_search", "mcp__misty__notes_search"])
      expect(isEditToolName(name)).toBe(false);
  });
});
