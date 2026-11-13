// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type * as GitApiModule from "./gitApi";
import { afterEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ diff: vi.fn(), diffImages: vi.fn() }));

vi.mock("./gitApi", async (importOriginal) => ({
  ...(await importOriginal<typeof GitApiModule>()),
  gitApi: api,
}));
vi.mock("../files/filesStore", () => ({
  useFilesStore: { getState: () => ({ openFile: vi.fn() }) },
}));

import { annotateDiff, diffLineKind, DiffView } from "./DiffView";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const status = { branch: "main", staged: [], unstaged: [], untracked: [] };

function show(file: string, staged: boolean) {
  render(
    <DiffView
      workspacePath="/ws"
      target={{ file, staged }}
      status={status}
      onBack={() => undefined}
    />,
  );
}

describe("DiffView", () => {
  it("shows both versions of a changed image instead of a patch", async () => {
    api.diffImages.mockResolvedValue({
      old: "data:image/png;base64,b2xk",
      new: "data:image/png;base64,bmV3",
    });
    show("brand/logo.png", false);
    await waitFor(() => expect(document.querySelectorAll("img")).toHaveLength(2));
    expect(api.diffImages).toHaveBeenCalledWith("/ws", "brand/logo.png", false);
    expect(api.diff).not.toHaveBeenCalled();
    const sources = [...document.querySelectorAll("img")].map((img) => img.getAttribute("src"));
    expect(sources).toEqual(["data:image/png;base64,b2xk", "data:image/png;base64,bmV3"]);
    expect(screen.getByText("Before")).toBeTruthy();
    expect(screen.getByText("After")).toBeTruthy();
  });

  it("shows one pane for an added image", async () => {
    api.diffImages.mockResolvedValue({ old: null, new: "data:image/webp;base64,bmV3" });
    show("brand/hero.webp", true);
    await waitFor(() => expect(document.querySelectorAll("img")).toHaveLength(1));
    expect(screen.getByText("New")).toBeTruthy();
    expect(screen.queryByText("Before")).toBeNull();
  });

  it("numbers a text file's lines and steps through its hunks", async () => {
    api.diff.mockResolvedValue("@@ -1 +1 @@\n-old\n+new\n@@ -9 +9 @@\n-a\n+b\n");
    show("src/app.ts", false);
    await waitFor(() => expect(screen.getByText("+new")).toBeTruthy());
    expect(api.diffImages).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("radio", { name: "Step by step" }));
    expect(screen.getByText("Step 1 of 2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    expect(screen.getByText("Step 2 of 2")).toBeTruthy();
  });
});

describe("annotateDiff", () => {
  it("numbers the old and new sides from each hunk header", () => {
    const lines = annotateDiff([
      "diff --git a/x b/x",
      "@@ -3,2 +5,3 @@",
      " same",
      "-gone",
      "+one",
      "+two",
    ]);
    expect(lines.map((line) => [line.oldNo, line.newNo])).toEqual([
      [null, null],
      [null, null],
      [3, 5],
      [4, null],
      [null, 6],
      [null, 7],
    ]);
  });

  it("doesn't take file headers for added or removed lines", () => {
    expect(diffLineKind("+++ b/x")).toBeNull();
    expect(diffLineKind("--- a/x")).toBeNull();
    expect(diffLineKind("+x")).toBe("add");
    expect(diffLineKind("@@ -1 +1 @@")).toBe("hunk");
  });
});
