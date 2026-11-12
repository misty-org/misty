// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { Check, GitBranch } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFilesStore } from "../../../context-panel/files/filesStore";
import { resolveSelectedRepository } from "../../../context-panel/files/repositorySelection";
import { gitErrorText, type BranchInfo } from "../../../context-panel/git/gitApi";
import { useGitStore } from "../../../context-panel/git/store";
import {
  ErrorNotification,
  Input,
  MenuTrigger,
  Popover,
  PopoverContent,
  Pressable,
} from "@/shared/ui";
import "../../../context-panel/git/git.css";

function baseName(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return idx < 0 ? trimmed : trimmed.slice(idx + 1);
}

/**
 * The repository the composer's branch chip follows: the chat's folder, or a repository nested in
 * it when the file tree has something inside that one selected.
 */
export function useBranchSwitcher(folder: string) {
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
  const branch = useGitStore((s) => (repo ? s.statusByWorkspace[repo]?.branch : undefined));
  const branches = useGitStore((s) => (repo ? s.branchesByWorkspace[repo] : undefined));
  const repoName = repo && folder && repo !== folder ? baseName(repo) : undefined;
  useEffect(() => {
    if (!repo) return;
    void useGitStore
      .getState()
      .refresh(repo)
      .catch(() => undefined);
  }, [repo]);
  const [error, setError] = useState("");
  const select = useCallback(
    (name: string) => {
      if (!repo) return;
      setError("");
      void useGitStore
        .getState()
        .checkout(repo, name)
        .catch((reason: unknown) => setError(gitErrorText(reason)));
    },
    [repo],
  );
  return { repo, branch, branches, repoName, error, clearError: () => setError(""), select };
}

/** The Git branch of the chat's folder in the composer bar, with a popover to search and switch. */
export function BranchMenu({ folder, disabled }: { folder: string; disabled?: boolean }) {
  const { repo, branch, branches, repoName, error, clearError, select } = useBranchSwitcher(folder);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (branches ?? []).filter((item) => !needle || item.name.toLowerCase().includes(needle));
  }, [branches, query]);
  if (!repo || !branch) return null;
  const value = repoName ? `${repoName} · ${branch}` : branch;
  return (
    <>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          // A checkout in a terminal changes them too; read them on each opening.
          if (next) void useGitStore.getState().loadBranches(repo);
        }}
      >
        <MenuTrigger
          kind="popover"
          label="Branch"
          icon={<GitBranch aria-hidden className="size-4 shrink-0" />}
          value={value}
          title={value}
          chevron={false}
          disabled={disabled}
          className="agent-strip-chip max-w-48"
        />
        <PopoverContent
          align="start"
          side="top"
          className="git-branches p-1.5"
          data-misty-layer-portal
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            searchRef.current?.focus();
          }}
        >
          <Input
            ref={searchRef}
            aria-label="Search branches"
            placeholder="Search branches"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="git-branch-list" role="listbox" aria-label="Branches">
            {filtered.map((item: BranchInfo) => {
              const current = item.name === branch;
              return (
                <Pressable
                  key={`${item.isRemote}:${item.name}`}
                  className="git-branch-row"
                  role="option"
                  aria-selected={current}
                  title={item.name}
                  onClick={() => {
                    setOpen(false);
                    // Compared with the status's branch: the list can lag behind a checkout elsewhere.
                    if (!current) select(item.name);
                  }}
                >
                  <span className="git-branch-check" aria-hidden="true">
                    {current ? <Check size={14} /> : null}
                  </span>
                  <span>{item.name}</span>
                  {item.isRemote ? <span className="git-branch-remote">Remote</span> : null}
                </Pressable>
              );
            })}
            {branches && query.trim() && !filtered.length ? (
              <p className="git-branch-empty">No matching branches</p>
            ) : null}
          </div>
        </PopoverContent>
      </Popover>
      {error ? <ErrorNotification message={error} onDismiss={clearError} /> : null}
    </>
  );
}
