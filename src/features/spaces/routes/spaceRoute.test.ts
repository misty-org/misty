import { describe, expect, it } from "vitest";
import { renamedSectionPath } from "./spaceRoute";
import { spaceItemKeyFromRoute } from "./spaceItemRoute";

describe("the Library became Media", () => {
  it.each([
    ["/spaces/s1/library", "/spaces/s1/media"],
    ["/spaces/s1/files", "/spaces/s1/media"],
    ["/spaces/s1/library/anything", "/spaces/s1/media/anything"],
  ])("%s opens %s", (old, current) => {
    expect(renamedSectionPath(old)).toBe(current);
  });

  it.each(["/spaces/s1/media", "/spaces/s1/notes", "/spaces/s1", "/agents/library"])(
    "%s is left as it is",
    (path) => {
      expect(renamedSectionPath(path)).toBeNull();
    },
  );

  it("a file is the same recent item under either name", () => {
    expect(spaceItemKeyFromRoute("/spaces/s1/media?item=f1", "s1")).toBe("file:f1");
    expect(spaceItemKeyFromRoute("/spaces/s1/library?item=f1", "s1")).toBe("file:f1");
  });
});

describe("a whiteboard, deck or workbook is one recent item", () => {
  it.each([
    ["/spaces/s1/drawings/d1", "drawing:d1"],
    ["/spaces/s1/slides/k1", "deck:k1"],
    ["/spaces/s1/data/w1", "workbook:w1"],
    ["/spaces/s1/notes?note=n1", "note:n1"],
  ])("%s is %s", (route, key) => {
    expect(spaceItemKeyFromRoute(route, "s1")).toBe(key);
  });
});
