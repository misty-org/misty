// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { Check, GitBranch, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Input, MenuTrigger, Popover, PopoverContent, Pressable, Tooltip } from "@/shared/ui";
import type { BranchInfo } from "./worktreeApi";
import "./worktree.css";

/** A branch picker with a search field, like the changes panel's. `blocked` names show as
 * disabled rows with the reason, never as buttons that do nothing. */
export function BranchCombobox({
  branches,
  value,
  onSelect,
  label,
  placeholder,
  blocked,
  blockedReason,
}: {
  branches: BranchInfo[];
  value: string | null;
  onSelect(name: string): void;
  /** The accessible name of the picker. */
  label: string;
  placeholder: string;
  blocked?: Set<string>;
  blockedReason?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return branches.filter((b) => !q || b.name.toLowerCase().includes(q));
  }, [branches, query]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <MenuTrigger
        kind="popover"
        variant="secondary"
        label={label}
        icon={GitBranch}
        value={value ?? <span className="text-cream-muted">{placeholder}</span>}
        className="worktree-branch-trigger"
      />
      <PopoverContent align="start" className="worktree-branch-popover">
        <div className="worktree-branch-search">
          <Search size={14} aria-hidden="true" className="text-cream-muted" />
          <Input
            autoFocus
            variant="default"
            aria-label="Search branches"
            placeholder="Search branches"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="worktree-branch-list" role="listbox" aria-label={label}>
          {filtered.length === 0 ? (
            <p className="worktree-branch-empty">No branches match</p>
          ) : null}
          {filtered.map((branch) => {
            const key = `${branch.isRemote ? "r" : "l"}:${branch.name}`;
            if (blocked?.has(branch.name)) {
              return (
                <Tooltip key={key} content={blockedReason ?? ""}>
                  <div className="worktree-branch-row" aria-disabled="true">
                    <span className="size-4 shrink-0" />
                    <span className="worktree-row-name">{branch.name}</span>
                    <span className="worktree-branch-tag">{blockedReason}</span>
                  </div>
                </Tooltip>
              );
            }
            return (
              <Pressable
                key={key}
                role="option"
                aria-selected={branch.name === value}
                className="worktree-branch-row"
                onClick={() => {
                  onSelect(branch.name);
                  setOpen(false);
                  setQuery("");
                }}
              >
                {branch.name === value ? (
                  <Check size={15} aria-hidden="true" className="shrink-0" />
                ) : (
                  <span className="size-4 shrink-0" />
                )}
                <span className="worktree-row-name">{branch.name}</span>
                {branch.isRemote ? <span className="worktree-branch-tag">Remote</span> : null}
              </Pressable>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
