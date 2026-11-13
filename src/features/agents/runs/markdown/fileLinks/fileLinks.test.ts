import { describe, expect, it } from "vitest";
import { isLinkableFilePath, resolveFilePath } from "./fileLinks";

describe("file links", () => {
  it("knows file paths from commands and prose", () => {
    for (const path of ["src/app.ts", "/Users/me/a.md", "./x/y", "C:\\work\\a.txt", "src/a.ts:12"])
      expect(isLinkableFilePath(path)).toBe(true);
    for (const text of ["/commit", "hello", "//host/share", "a/b", "and/or"])
      expect(isLinkableFilePath(text)).toBe(false);
  });

  it("anchors relative paths at the folder and strips line numbers", () => {
    expect(resolveFilePath("src/a.ts:12:3", "/w")).toBe("/w/src/a.ts");
    expect(resolveFilePath("/abs/a.ts#L5", "/w")).toBe("/abs/a.ts");
    expect(resolveFilePath("../up.ts", "/w")).toBeNull();
    expect(resolveFilePath("src/a.ts", "")).toBeNull();
  });
});
