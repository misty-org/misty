// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { describe, expect, it } from "vitest";
import {
  defaultBaseRef,
  defaultWorktreePath,
  dirNameOf,
  isPlausibleBranchName,
  randomBranchSuffix,
  joinPath,
  parentDirOf,
  parsePrInput,
  sanitizeDirName,
  slugifyTitle,
  suggestPrBranch,
} from "./prInput";

describe("parsePrInput", () => {
  it("accepts bare numbers and #-prefixed numbers", () => {
    expect(parsePrInput("1842")).toBe(1842);
    expect(parsePrInput("  #1842 ")).toBe(1842);
  });

  it("extracts the number from GitHub PR URLs with any suffix", () => {
    expect(parsePrInput("https://github.com/o/r/pull/1842")).toBe(1842);
    expect(parsePrInput("https://github.com/o/r/pull/1842/files")).toBe(1842);
    expect(parsePrInput("https://github.com/o/r/pull/1842?diff=split")).toBe(1842);
  });

  it("rejects non-PR input", () => {
    expect(parsePrInput("")).toBeNull();
    expect(parsePrInput("abc")).toBeNull();
    expect(parsePrInput("0")).toBeNull();
    expect(parsePrInput("https://github.com/o/r/issues/12")).toBeNull();
    expect(parsePrInput("https://github.com/o/r/pull/")).toBeNull();
    expect(parsePrInput("pr-1842")).toBeNull();
  });
});

describe("slugifyTitle", () => {
  it("keeps at most the first four ASCII words as kebab-case", () => {
    expect(slugifyTitle("Refactor workspace sidebar into sections v2")).toBe(
      "refactor-workspace-sidebar-into",
    );
    expect(slugifyTitle("fix: Crash on quit!")).toBe("fix-crash-on-quit");
  });

  it("returns empty for titles without ASCII content", () => {
    expect(slugifyTitle("ÉÈ ñ")).toBe("");
    expect(slugifyTitle("!!!")).toBe("");
  });
});

describe("suggestPrBranch", () => {
  it("appends the slug when a title is known, falls back to bare pr-N", () => {
    expect(suggestPrBranch(1842, "Add worktree support for parallel review")).toBe(
      "pr-1842-add-worktree-support-for",
    );
    expect(suggestPrBranch(1842, "—")).toBe("pr-1842");
    expect(suggestPrBranch(1842, null)).toBe("pr-1842");
    expect(suggestPrBranch(1842)).toBe("pr-1842");
  });

  it("keeps the three-digit suffix at the end (avoids stale local branch clashes)", () => {
    expect(suggestPrBranch(1842, "Add worktree support for parallel review", "482")).toBe(
      "pr-1842-add-worktree-support-for-482",
    );
    expect(suggestPrBranch(1842, "—", "007")).toBe("pr-1842-007");
    expect(suggestPrBranch(1842, null, "119")).toBe("pr-1842-119");
  });
});

describe("randomBranchSuffix", () => {
  it("is always three digits, never a leading zero", () => {
    for (let i = 0; i < 200; i += 1) {
      expect(randomBranchSuffix()).toMatch(/^[1-9]\d{2}$/);
    }
  });
});

describe("isPlausibleBranchName", () => {
  it("accepts ordinary branch names", () => {
    expect(isPlausibleBranchName("feature/parallel-review")).toBe(true);
    expect(isPlausibleBranchName("pr-1842-add-x")).toBe(true);
  });

  it("rejects names git check-ref-format would reject", () => {
    for (const bad of [
      "",
      "has space",
      "tilde~1",
      "caret^",
      "quest?",
      "star*",
      "brack[et",
      "dots..",
      "-leading-dash",
      "/leading-slash",
      "trailing/",
      "file.lock",
    ]) {
      expect(isPlausibleBranchName(bad)).toBe(false);
    }
  });
});

describe("path helpers", () => {
  it("split and join with forward separators", () => {
    expect(parentDirOf("/repo/app")).toBe("/repo");
    expect(dirNameOf("/repo/app")).toBe("app");
    expect(joinPath("/repo", "child")).toBe("/repo/child");
    expect(joinPath("/repo/", "child")).toBe("/repo/child");
  });

  it("keep the filesystem root as its own parent", () => {
    expect(parentDirOf("/app")).toBe("/");
  });

  it("split and join with backslash separators", () => {
    expect(parentDirOf("C:\\repo\\app")).toBe("C:\\repo");
    expect(dirNameOf("C:\\repo\\app")).toBe("app");
    expect(joinPath("C:\\repo", "child")).toBe("C:\\repo\\child");
  });

  it("sanitizeDirName flattens nested branch names", () => {
    expect(sanitizeDirName("feature/parallel/review")).toBe("feature-parallel-review");
  });
});

describe("defaultBaseRef", () => {
  const locals = (...names: string[]) => names.map((name) => ({ name, isRemote: false }));
  const remote = (name: string) => ({ name, isRemote: true });

  it("uses the current branch as the default base", () => {
    const list = [...locals("main", "v1.0.9"), { name: "origin/main", isRemote: true }];
    expect(defaultBaseRef(list, "v1.0.9")).toBe("v1.0.9");
  });

  it("prefers the remote main or master, since the local one may lag behind", () => {
    expect(defaultBaseRef([...locals("main"), remote("origin/main")], "main")).toBe("origin/main");
    expect(defaultBaseRef([...locals("master"), remote("origin/master")], "master")).toBe(
      "origin/master",
    );
    // Without a remote the local one is used.
    expect(defaultBaseRef(locals("main"), "main")).toBe("main");
  });

  it("falls back for a detached HEAD or an unknown branch", () => {
    const list = [...locals("main", "dev"), remote("origin/main")];
    expect(defaultBaseRef(list, "HEAD")).toBe("origin/main");
    expect(defaultBaseRef(list, "gone-branch")).toBe("origin/main");
    expect(defaultBaseRef(list, undefined)).toBe("origin/main");
  });

  it("then any remote, then the first branch, and nothing for no branches", () => {
    expect(defaultBaseRef([...locals("dev"), remote("origin/dev")], "dev")).toBe("dev");
    expect(defaultBaseRef([remote("origin/dev"), ...locals("zz")], undefined)).toBe("origin/dev");
    expect(defaultBaseRef(locals("zz"), undefined)).toBe("zz");
    expect(defaultBaseRef([], "main")).toBeNull();
  });
});

describe("defaultWorktreePath", () => {
  it("places worktrees in a sibling <repo>-worktrees directory", () => {
    expect(defaultWorktreePath("/repo/app", "pr-1842-x")).toBe("/repo/app-worktrees/pr-1842-x");
    expect(defaultWorktreePath("/repo/app", "feature/x")).toBe("/repo/app-worktrees/feature-x");
    expect(defaultWorktreePath("C:\\repo\\app", "b")).toBe("C:\\repo\\app-worktrees\\b");
  });
});
