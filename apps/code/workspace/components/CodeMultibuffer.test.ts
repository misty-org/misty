import { ChangeSet } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import type { CodeMultibufferSpec } from "@/features/workspace";
import type { OpenTab } from "../store/useCodingWorkspaceStore";
import { buildMultibufferDocument, changesStayInsideExcerpts } from "./CodeMultibuffer";

describe("Code multibuffer model", () => {
  const spec: CodeMultibufferSpec = {
    id: "search:test",
    kind: "search",
    title: "Search: value",
    query: "value",
    caseSensitive: false,
  };

  it("merges nearby matches into one editable excerpt", () => {
    const buffer = tab("/repo/a.ts", "one\ntwo\nvalue\nfour\nvalue\nsix\n");
    const document = buildMultibufferDocument(
      "/repo",
      spec,
      [
        { path: buffer.path, relative: "a.ts", lineNumber: 3, line: "value", column: 0 },
        { path: buffer.path, relative: "a.ts", lineNumber: 5, line: "value", column: 0 },
      ],
      { [buffer.path]: buffer },
      new Map(),
    );

    expect(document.excerpts).toHaveLength(1);
    expect(document.text).toContain("── a.ts:1-6 ──");
    expect(document.text).toContain(buffer.contents);
  });

  it("accepts edits inside excerpts and rejects separator edits", () => {
    const buffer = tab("/repo/a.ts", "value\n");
    const document = buildMultibufferDocument(
      "/repo",
      spec,
      [{ path: buffer.path, relative: "a.ts", lineNumber: 1, line: "value", column: 0 }],
      { [buffer.path]: buffer },
      new Map(),
    );
    const excerpt = document.excerpts[0]!;

    expect(
      changesStayInsideExcerpts(
        ChangeSet.of({ from: excerpt.virtualFrom, insert: "new " }, document.text.length),
        document.excerpts,
      ),
    ).toBe(true);
    expect(
      changesStayInsideExcerpts(
        ChangeSet.of({ from: excerpt.headerFrom, insert: "x" }, document.text.length),
        document.excerpts,
      ),
    ).toBe(false);
  });
});

function tab(path: string, contents: string): OpenTab {
  return {
    path,
    name: path.split("/").pop() ?? path,
    contents,
    savedContents: contents,
    lineEnding: "lf",
    readonly: false,
    loading: false,
    error: null,
  };
}
