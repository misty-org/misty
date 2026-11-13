// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { Check, GitBranch } from "lucide-react";
import { useMemo, useState } from "react";
import {
  cn,
  MenuTrigger,
  PickerList,
  PickerSearch,
  Popover,
  PopoverContent,
  Pressable,
  Text,
  Tooltip,
} from "@/shared/ui";
import type { BranchInfo } from "./worktreeApi";

/** A branch row: the check column, the name, then where it lives or why it can't be picked. */
const rowClass = "flex h-7.5 min-w-0 items-center gap-2 rounded-md px-2 text-meta";

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
        value={
          value ?? (
            <Text bare tone="muted">
              {placeholder}
            </Text>
          )
        }
        justify="start"
        className="w-full [&>[data-text-overflowing]]:ml-auto"
      />
      <PopoverContent align="start" size="trigger" kind="flush">
        <PickerSearch
          autoFocus
          aria-label="Search branches"
          placeholder="Search branches"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <PickerList role="listbox" aria-label={label}>
          {filtered.length === 0 ? (
            <Text as="p" size="meta" tone="muted" className="px-2 py-1.5">
              No branches match
            </Text>
          ) : null}
          {filtered.map((branch) => {
            const key = `${branch.isRemote ? "r" : "l"}:${branch.name}`;
            if (blocked?.has(branch.name)) {
              return (
                <Tooltip key={key} content={blockedReason ?? ""}>
                  <Text
                    bare
                    as="div"
                    tone="muted"
                    className={cn(rowClass, "cursor-not-allowed")}
                    aria-disabled="true"
                  >
                    <span className="size-4 shrink-0" />
                    <Text className="flex-1">{branch.name}</Text>
                    <Text className="max-w-[45%] flex-none text-micro">{blockedReason}</Text>
                  </Text>
                </Tooltip>
              );
            }
            return (
              <Pressable
                key={key}
                role="option"
                aria-selected={branch.name === value}
                wash="control"
                className={rowClass}
                onClick={() => {
                  onSelect(branch.name);
                  setOpen(false);
                  setQuery("");
                }}
              >
                {branch.name === value ? (
                  <Check aria-hidden="true" className="shrink-0" />
                ) : (
                  <span className="size-4 shrink-0" />
                )}
                <Text tone="default" className="flex-1">
                  {branch.name}
                </Text>
                {branch.isRemote ? (
                  <Text tone="muted" className="max-w-[45%] flex-none text-micro">
                    Remote
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
        </PickerList>
      </PopoverContent>
    </Popover>
  );
}
