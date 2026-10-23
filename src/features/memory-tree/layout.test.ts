import { describe, expect, it } from "vitest";
import { layoutTree, NODE_H } from "./layout";
import { type MemoryNode, ROOT_ID } from "./model";
import { isHidden, visibleTree } from "./visibleTree";

const node = (id: string, parent: string, extra: Partial<MemoryNode> = {}): MemoryNode => ({
  id,
  parent,
  type: "group",
  branch: "moments",
  label: id,
  count: 1,
  searchable: true,
  expandable: true,
  ...extra,
});

const children = {
  "": [node("moments", ROOT_ID, { type: "branch" }), node("facts", ROOT_ID, { type: "branch" })],
  moments: [node("moments:site:a.com", "moments", { source: "page" })],
  "moments:site:a.com": [
    node("moment:1", "moments:site:a.com", { type: "moment" }),
    node("moment:2", "moments:site:a.com", { type: "moment" }),
  ],
};

describe("visibleTree", () => {
  it("shows branches until something is expanded", () => {
    const ids = visibleTree(children, new Set(), new Set()).map((n) => n.id);
    expect(ids).toEqual([ROOT_ID, "moments", "facts"]);
  });

  it("opens expanded nodes depth first", () => {
    const expanded = new Set(["moments", "moments:site:a.com"]);
    const ids = visibleTree(children, expanded, new Set()).map((n) => n.id);
    expect(ids).toEqual([
      ROOT_ID,
      "moments",
      "moments:site:a.com",
      "moment:1",
      "moment:2",
      "facts",
    ]);
  });

  it("hides nodes and whole sources named by filters", () => {
    const expanded = new Set(["moments"]);
    expect(visibleTree(children, expanded, new Set(["facts"])).map((n) => n.id)).not.toContain(
      "facts",
    );
    expect(
      visibleTree(children, expanded, new Set(["source:page"])).map((n) => n.id),
    ).not.toContain("moments:site:a.com");
    expect(
      isHidden(node("x", "y", { type: "moment", source: "page" }), new Set(["source:page"])),
    ).toBe(false);
  });
});

describe("layoutTree", () => {
  it("puts each depth in a column and centres parents on their children", () => {
    const expanded = new Set(["moments", "moments:site:a.com"]);
    const positions = layoutTree(visibleTree(children, expanded, new Set()));
    const leaf1 = positions.get("moment:1")!;
    const leaf2 = positions.get("moment:2")!;
    expect(leaf2.y).toBeGreaterThan(leaf1.y + NODE_H - 1);
    expect(positions.get("moments:site:a.com")!.y).toBeCloseTo((leaf1.y + leaf2.y) / 2);
    expect(positions.get("moments")!.x).toBeLessThan(positions.get("moment:1")!.x);
    expect(positions.get(ROOT_ID)!.x).toBe(0);
  });
});
