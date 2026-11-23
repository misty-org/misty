import { describe, expect, it } from "vitest";
import { renamedSectionPath } from "./space_route";
import { spaceItemKeyFromRoute } from "./space_item_route";

describe("the Library, then Media, became Files", () => {
  it.each([
    ["/spaces/s1/library", "/spaces/s1/files"],
    ["/spaces/s1/media", "/spaces/s1/files"],
    ["/spaces/s1/library/anything", "/spaces/s1/files/anything"],
    ["/spaces/s1/agents", "/spaces/s1/explore"],
  ])("%s opens %s", (old, current) => {
    expect(renamedSectionPath(old)).toBe(current);
  });

  it.each(["/spaces/s1/files", "/spaces/s1/chat", "/spaces/s1", "/agents/library"])(
    "%s is left as it is",
    (path) => {
      expect(renamedSectionPath(path)).toBeNull();
    },
  );

  it("a file is the same recent item under any of its names", () => {
    expect(spaceItemKeyFromRoute("/spaces/s1/files?item=f1", "s1")).toBe("file:f1");
    expect(spaceItemKeyFromRoute("/spaces/s1/media?item=f1", "s1")).toBe("file:f1");
    expect(spaceItemKeyFromRoute("/spaces/s1/library?item=f1", "s1")).toBe("file:f1");
  });
});

describe("recent items", () => {
  it.each([
    ["/spaces/s1/social?conversation=c1", "chat:c1"],
    ["/spaces/s1/social/misty", "chat:everyone"],
  ])("%s is %s", (route, key) => {
    expect(spaceItemKeyFromRoute(route, "s1")).toBe(key);
  });

  it.each([
    "/spaces/s1/drawings/d1",
    "/spaces/s1/notes?note=n1",
    "/spaces/s1/files?item=f1&collection=deleted",
  ])("%s is none", (route) => {
    expect(spaceItemKeyFromRoute(route, "s1")).toBeUndefined();
  });
});
