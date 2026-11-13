import { describe, expect, it } from "vitest";
import { createDockLeaf, dockLeaves, isGridLayout } from "./dockTree";
import { draftAdd, draftPlace, draftRemove } from "./layoutDraft";
import type { WorkspaceView } from "../tabs/workspaceViews";

const view = (id: string) => ({ id, title: id }) as unknown as WorkspaceView;
const ids = (root: Parameters<typeof dockLeaves>[0]) =>
  dockLeaves(root).map((pane) => pane.views[0]?.id);

describe("layout draft", () => {
  const a = view("a");
  const b = view("b");
  const c = view("c");
  const base = createDockLeaf([a]);

  it("splits a pane on its edge and puts the tab first on the left", () => {
    const next = draftPlace(base, b, base.id, "left")!;
    expect(ids(next)).toEqual(["b", "a"]);
  });

  it("replaces a pane's view from its middle, dropping the old view from the draft", () => {
    const next = draftPlace(base, b, base.id, "center")!;
    expect(ids(next)).toEqual(["b"]);
  });

  it("trades places when a pane is dropped on another pane's middle", () => {
    const two = draftPlace(base, b, base.id, "right")!;
    const [left, right] = dockLeaves(two);
    const swapped = draftPlace(two, b, left.id, "center")!;
    expect(ids(swapped)).toEqual(["b", "a"]);
    expect(right.views[0].id).toBe("b");
  });

  it("moves a view already in the draft instead of duplicating it", () => {
    const two = draftPlace(base, b, base.id, "right")!;
    const first = dockLeaves(two)[0];
    const moved = draftPlace(two, b, first.id, "up")!;
    expect(ids(moved)).toEqual(["b", "a"]);
  });

  it("never makes a row of three, and fills a two by two grid instead", () => {
    const two = draftPlace(base, b, base.id, "right")!;
    // A third pane beside the pair would make a row of three.
    expect(draftPlace(two, c, dockLeaves(two)[1].id, "right")).toBeNull();
    const three = draftAdd(two, c)!;
    expect(dockLeaves(three)).toHaveLength(3);
    const four = draftAdd(three, view("d"))!;
    expect(dockLeaves(four)).toHaveLength(4);
    expect(isGridLayout(four)).toBe(true);
    expect(draftAdd(four, view("e"))).toBeNull();
    expect(draftPlace(base, a, base.id, "left")).toBeNull();
  });

  it("folds a removed pane away, and the last one leaves nothing", () => {
    const two = draftPlace(base, b, base.id, "right")!;
    expect(ids(draftRemove(two, "a")!)).toEqual(["b"]);
    expect(draftRemove(base, "a")).toBeNull();
  });
});
