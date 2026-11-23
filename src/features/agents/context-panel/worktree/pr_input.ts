// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import type { BranchInfo } from "./worktree_api";

export function parsePrInput(input: string): number | null {
  const t = input.trim();
  const bare = t.startsWith("#") ? t.slice(1) : t;
  if (/^\d+$/.test(bare)) {
    const n = Number(bare);
    return n > 0 ? n : null;
  }
  const idx = t.indexOf("/pull/");
  if (idx < 0) return null;
  const digits = t.slice(idx + "/pull/".length).match(/^\d+/)?.[0];
  if (!digits) return null;
  const n = Number(digits);
  return n > 0 ? n : null;
}

export function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .split("-")
    .filter(Boolean)
    .slice(0, 4)
    .join("-");
}

export function randomBranchSuffix(): string {
  return String(Math.floor(Math.random() * 900) + 100);
}

export function suggestPrBranch(
  prNumber: number,
  prTitle?: string | null,
  suffix?: string,
): string {
  const slug = prTitle ? slugifyTitle(prTitle) : "";
  const base = slug ? `pr-${prNumber}-${slug}` : `pr-${prNumber}`;
  return suffix ? `${base}-${suffix}` : base;
}

export function isPlausibleBranchName(name: string): boolean {
  return (
    name !== "" &&
    !/[\s~^:?*[\\]/.test(name) &&
    !name.includes("..") &&
    !name.startsWith("-") &&
    !name.startsWith("/") &&
    !name.endsWith("/") &&
    !name.endsWith(".lock")
  );
}

export function sanitizeDirName(name: string): string {
  return name
    .replace(/[\\/]+/g, "-")
    .replace(/^\.+/, "")
    .trim();
}

export function parentDirOf(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return idx > 0 ? trimmed.slice(0, idx) : trimmed.slice(0, Math.max(idx, 0) + 1);
}

export function dirNameOf(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return trimmed.slice(idx + 1);
}

export function joinPath(base: string, child: string): string {
  const sep = base.includes("\\") && !base.includes("/") ? "\\" : "/";
  return base.replace(/[\\/]+$/, "") + sep + child;
}

export function defaultBaseRef(
  branches: BranchInfo[],
  current: string | null | undefined,
): string | null {
  if (branches.length === 0) return null;
  const names = new Set(branches.map((b) => b.name));
  if (current && current !== "main" && current !== "master" && names.has(current)) {
    return current;
  }
  const preferred = ["origin/main", "origin/master", "main", "master"].find((n) => names.has(n));
  return preferred ?? branches.find((b) => b.isRemote)?.name ?? branches[0].name;
}

export function defaultWorktreePath(repoPath: string, branch: string): string {
  const root = joinPath(parentDirOf(repoPath), `${dirNameOf(repoPath)}-worktrees`);
  return joinPath(root, sanitizeDirName(branch));
}
