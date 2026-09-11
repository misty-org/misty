import { expect, it } from "vitest";
import { createDockLeaf, insertDockSplit } from "./dockTree";
import { liftPanePresentation } from "./paneDragPresentation";
it("fills the lifted pane's gap and restores both panes exactly", () => {
  const a = createDockLeaf(),
    b = createDockLeaf();
  const root = insertDockSplit(a, a.id, b, "down");
  const host = document.createElement("div");
  host.setAttribute("data-misty-desktop-frame", "");
  const top = document.createElement("section"),
    bottom = document.createElement("section");
  top.dataset.workspacePane = a.id;
  bottom.dataset.workspacePane = b.id;
  top.getBoundingClientRect = () => new DOMRect(0, 0, 1000, 400);
  bottom.getBoundingClientRect = () => new DOMRect(0, 400, 1000, 400);
  host.append(top, bottom);
  document.body.append(host);
  try {
    const restore = liftPanePresentation(root, b.id);
    expect(bottom.style.visibility).toBe("hidden");
    expect(top.style.height).toBe("800px");
    expect(root.type).toBe("split");
    restore();
    expect(top.getAttribute("style")).toBeNull();
    expect(bottom.getAttribute("style")).toBeNull();
  } finally {
    host.remove();
  }
});
