// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { Cloud, GitBranch } from "lucide-react";
import { useEffect, useMemo } from "react";
import { useFilesStore } from "../../../context-panel/files/filesStore";
import { resolveSelectedRepository } from "../../../context-panel/files/repositorySelection";
import { gitErrorText, type BranchInfo } from "../../../context-panel/git/gitApi";
import { useGitStore } from "../../../context-panel/git/store";
import { notify, type PathLineSegment, type SearchablePickerOption } from "@/shared/ui";

function baseName(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return idx < 0 ? trimmed : trimmed.slice(idx + 1);
}

/** Branches as picker rows: remote ones marked by their icon, keyed apart from a local namesake. */
function branchOptions(branches: ReadonlyArray<BranchInfo>): SearchablePickerOption[] {
  return branches.map((branch) => ({
    id: `${branch.isRemote ? "remote" : "local"}:${branch.name}`,
    value: branch.name,
    label: branch.name,
    icon: branch.isRemote ? Cloud : GitBranch,
  }));
}

/**
 * The repository the composer's branch follows: the chat's folder, or a repository nested in it
 * when the file tree has something inside that one selected.
 */
function useBranchRepository(folder: string) {
  const selectedPath = useFilesStore((s) => s.selectedPath);
  const repositories = useFilesStore((s) => s.repositories);
  const repo = useMemo(() => {
    if (!folder) return null;
    return (
      resolveSelectedRepository({
        selectedPath,
        repositoryRoots: Object.keys(repositories),
        workspacePath: folder,
      }) ?? folder
    );
  }, [folder, selectedPath, repositories]);
  useEffect(() => {
    if (!repo) return;
    const git = useGitStore.getState();
    void git.refresh(repo).catch(() => undefined);
    void git.loadBranches(repo).catch(() => undefined);
  }, [repo]);
  return repo;
}

/**
 * The branch part of the composer's path line: the Git branch of the chat's folder, opening a
 * searchable list of the branches to switch to. Nothing when the folder isn't a repository.
 */
export function useBranchSegment(folder: string): PathLineSegment | null {
  const repo = useBranchRepository(folder);
  const branch = useGitStore((s) => (repo ? s.statusByWorkspace[repo]?.branch : undefined));
  const branches = useGitStore((s) => (repo ? s.branchesByWorkspace[repo] : undefined));
  if (!repo || !branch) return null;
  const repoName = repo !== folder ? baseName(repo) : undefined;
  return {
    id: "branch",
    icon: GitBranch,
    label: repoName ? `${repoName} · ${branch}` : branch,
    picker: {
      label: "Branch",
      options: branches && branchOptions(branches),
      value: branch,
      searchLabel: "Search branches",
      emptyLabel: "No branches match",
      // Branches change outside Misty too, so the list reads them again as it opens.
      onOpen: () =>
        void useGitStore
          .getState()
          .loadBranches(repo)
          .catch(() => undefined),
      onPick: (name) => {
        // Compared with the status's branch: the list can lag behind a checkout elsewhere.
        if (name === branch) return;
        void useGitStore
          .getState()
          .checkout(repo, name)
          .catch((reason: unknown) =>
            notify({ message: gitErrorText(reason), tone: "error", id: "composer-branch" }),
          );
      },
    },
  };
}
