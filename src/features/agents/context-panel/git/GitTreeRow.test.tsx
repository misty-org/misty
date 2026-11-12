// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildGitTree, type GitTreeDirNode } from "./git-tree";
import { DirectoryRow, FileRow } from "./GitTreeRow";

afterEach(cleanup);

const row = (status: "modified" | "added" | "deleted", isNew = false) =>
  render(
    <ul>
      <FileRow
        entry={{ path: "src/main/App.java", status, additions: 4, deletions: 2 }}
        actionLabel="Stage"
        actionKind="stage"
        onAction={vi.fn()}
        onOpen={vi.fn()}
        actionBusy={false}
        isNew={isNew}
      />
    </ul>,
  );

describe("FileRow", () => {
  it("marks a changed file with its letter, its color and its line counts", () => {
    row("modified");
    const letter = screen.getByText("M");
    expect(letter.getAttribute("data-git-status")).toBe("modified");
    expect(screen.getByText("App.java").getAttribute("data-git-status")).toBe("modified");
    expect(screen.getByText("src/main/")).toBeTruthy();
    expect(screen.getByText("+4")).toBeTruthy();
    expect(screen.getByText("−2")).toBeTruthy();
    expect(document.querySelector(".git-row-icon svg")).toBeTruthy();
  });

  it("marks a deleted file and an untracked one", () => {
    row("deleted");
    expect(screen.getByText("D").getAttribute("data-git-status")).toBe("deleted");
    cleanup();
    row("added", true);
    expect(screen.getByText("?").getAttribute("data-git-status")).toBe("untracked");
  });

  it("opens the diff from the name and stages from its action", () => {
    const onOpen = vi.fn();
    const onAction = vi.fn();
    render(
      <ul>
        <FileRow
          entry={{ path: "a.ts", status: "modified" }}
          actionLabel="Stage"
          actionKind="stage"
          onAction={onAction}
          onOpen={onOpen}
          actionBusy={false}
        />
      </ul>,
    );
    fireEvent.click(screen.getByRole("button", { name: "a.ts" }));
    fireEvent.click(screen.getByRole("button", { name: "Stage" }));
    expect(onOpen).toHaveBeenCalledWith("a.ts");
    expect(onAction).toHaveBeenCalledWith("a.ts");
  });
});

describe("DirectoryRow", () => {
  it("toggles open and ticks every file below it", () => {
    const [node] = buildGitTree([
      { path: "src/a.ts", status: "modified" },
      { path: "src/b.ts", status: "added" },
    ]) as GitTreeDirNode[];
    const onToggleOpen = vi.fn();
    const onToggleSelect = vi.fn();
    render(
      <ul>
        <DirectoryRow
          node={node}
          isOpen
          onToggleOpen={onToggleOpen}
          selectedState="some"
          onToggleSelect={onToggleSelect}
          actionBusy={false}
        />
      </ul>,
    );
    expect(screen.getByText("(2)")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Collapse folder src" }));
    expect(onToggleOpen).toHaveBeenCalledWith(node.id);
    const box = screen.getByRole("checkbox", { name: "src" });
    expect(box.getAttribute("data-state")).toBe("indeterminate");
    fireEvent.click(box);
    expect(onToggleSelect).toHaveBeenCalledWith(["src/a.ts", "src/b.ts"]);
  });
});
