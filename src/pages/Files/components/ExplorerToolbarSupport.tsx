import { Check } from "lucide-react";
import type { ReactNode } from "react";
import type { SearchResult } from "../../../api/types";

export const toolbarStyles = {
  root:
    "min-w-0 overflow-visible border-b border-[var(--misty-border-soft)] bg-[var(--misty-bg-soft)] max-[720px]:overflow-x-auto max-[720px]:overflow-y-hidden max-[720px]:[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
  navRow: "grid min-w-0 grid-cols-[auto_minmax(240px,1fr)_minmax(280px,440px)] items-center gap-3 overflow-visible px-3 py-1.5 max-[980px]:grid-cols-[auto_minmax(180px,1fr)_minmax(240px,360px)]",
  actionRow: "grid min-h-12 min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center justify-between gap-3 overflow-hidden border-t border-[var(--misty-border-soft)] px-3 py-1.5",
  navButtons: "flex min-w-0 flex-none items-center gap-1",
  actionLeft: "flex min-w-0 items-center gap-1.5 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
  toolbarButton:
    "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border-0 bg-transparent px-2 py-1 leading-none text-[var(--misty-text-muted)] hover:bg-[var(--misty-surface-hover)] hover:text-[var(--misty-text)] disabled:cursor-default disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-[var(--misty-text-muted)]",
  pathBar:
    "flex h-8 min-w-0 items-center gap-0.5 overflow-x-auto overflow-y-hidden rounded-lg border border-[var(--misty-border)] bg-[var(--misty-surface)] px-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
  pathBarEditing: "border-[var(--misty-border-strong)] shadow-[0_0_0_2px_rgba(241,243,244,0.08)]",
  pathButton: "inline-flex h-7 min-w-[auto] flex-none items-center gap-0 border-0 bg-transparent px-1 py-0 leading-none text-[var(--misty-text)]",
  pathInput: "!h-full !min-w-0 !w-full !appearance-none !rounded-none !border-0 !bg-transparent !p-0 !font-[inherit] !leading-none !text-[var(--misty-text)] !shadow-none !outline-0 placeholder:!text-[var(--misty-text-subtle)]",
  breadcrumbCaret: "mr-[7px] flex-none text-[var(--misty-text-subtle)]",
  commandSearch:
    "!flex !h-8 !w-full !min-w-0 !items-center !gap-2 rounded-lg border border-[var(--misty-border)] bg-[var(--misty-surface)] px-2.5 !text-[var(--misty-text-subtle)] !normal-case focus-within:border-[var(--misty-border-strong)] focus-within:shadow-[0_0_0_2px_rgba(241,243,244,0.08)] max-[980px]:w-full max-[720px]:min-w-40",
  commandSearchGroup:
    "grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5",
  commandSearchMode: "border-[var(--misty-border-strong)] bg-[var(--misty-surface-selected)] text-[var(--misty-text)]",
  commandInput: "!h-full !min-w-0 !flex-1 !appearance-none !rounded-none !border-0 !bg-transparent !p-0 !text-[var(--misty-text)] !shadow-none !outline-0 placeholder:!text-[var(--misty-text-subtle)]",
  searchModeToggle:
    "flex h-8 flex-none items-center gap-px overflow-hidden rounded-lg border border-[var(--misty-border)] bg-[var(--misty-surface)] p-0.5",
  searchModeButton:
    "grid size-[26px] place-items-center rounded-md border-0 bg-transparent p-0 text-[var(--misty-text-subtle)] hover:bg-[var(--misty-surface-hover)] hover:text-[var(--misty-text)]",
  searchModeButtonActive:
    "bg-[var(--misty-surface-selected)] text-[var(--misty-text)]",
  palette: "grid gap-0.5 rounded-xl border border-[var(--misty-border)] bg-[var(--misty-glass)] p-[7px] shadow-[0_18px_40px_var(--misty-shadow)] backdrop-blur-xl",
  paletteButton:
    "flex min-h-12 w-full items-center gap-2.5 rounded-[9px] border-0 bg-transparent px-[9px] py-[7px] text-left text-[var(--misty-text)] hover:bg-[var(--misty-surface-hover)] hover:text-[var(--misty-primary-hover)] focus-visible:bg-[var(--misty-surface-hover)] focus-visible:text-[var(--misty-primary-hover)]",
  paletteText: "grid min-w-0 gap-0.5",
  paletteTitle: "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-semibold",
  paletteSubtitle: "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-[var(--misty-text-subtle)]",
  paletteEmpty: "p-2.5 text-xs text-[var(--misty-text-subtle)]",
  paletteDivider: "my-1 h-px bg-[var(--misty-border)]",
  paletteSection: "px-2 pb-1 pt-1 text-[10px] font-bold uppercase tracking-normal text-[var(--misty-text-subtle)]",
  newButton:
    "inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-[var(--misty-border)] bg-[var(--misty-surface)] px-3 py-0 leading-none text-[var(--misty-text)] hover:bg-[var(--misty-surface-hover)] hover:border-[var(--misty-border-strong)]",
  newMenu: "grid w-52 gap-0.5 rounded-[13px] border border-[var(--misty-border)] bg-[var(--misty-glass)] p-2 shadow-[0_18px_40px_var(--misty-shadow)] backdrop-blur-xl",
  newItem:
    "flex h-12 w-full items-center justify-start gap-3 rounded-[9px] border-0 bg-transparent px-3 py-0 text-left text-base text-[var(--misty-text)] hover:bg-[var(--misty-surface-hover)] hover:text-[var(--misty-primary-hover)] disabled:cursor-default disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-[var(--misty-text)]",
  overflowMenu: "grid w-60 gap-0.5 rounded-[13px] border border-[var(--misty-border)] bg-[var(--misty-glass)] p-2 shadow-[0_18px_40px_var(--misty-shadow)] backdrop-blur-xl",
  overflowSection: "px-2 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-normal text-[var(--misty-text-subtle)]",
  overflowItem:
    "grid min-h-9 w-full grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-2 rounded-[8px] border-0 bg-transparent px-2 py-1.5 text-left text-sm text-[var(--misty-text)] hover:bg-[var(--misty-surface-hover)] hover:text-[var(--misty-primary-hover)] disabled:cursor-default disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-[var(--misty-text)]",
  overflowItemText: "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap",
  overflowItemMeta: "flex-none text-xs text-[var(--misty-text-subtle)]",
  overflowItemIcon: "grid size-5 place-items-center text-[var(--misty-text-muted)]",
  overflowItemTrailing: "flex min-w-4 flex-none items-center justify-end gap-1.5",
  overflowItemCheck: "grid size-4 place-items-center text-[var(--misty-text)]",
  overflowSeparator: "mx-1 my-1 h-px bg-[var(--misty-border)]",
} as const;

export const paneToolbarActionStyles = {
  section:
    "flex h-7 flex-none items-center gap-px overflow-hidden rounded-lg border border-[var(--misty-border)] bg-[var(--misty-surface)] p-0.5",
  button:
    "grid h-[22px] w-7 place-items-center rounded-md border-0 bg-transparent p-0 text-[var(--misty-text-muted)] hover:bg-[var(--misty-surface-hover)] hover:text-[var(--misty-text)] disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[var(--misty-text-muted)]",
  buttonActive: "bg-[var(--misty-surface-selected)] text-[var(--misty-text)]",
} as const;

export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export function OverflowMenuItem(props: {
  icon?: ReactNode;
  label: string;
  meta?: string;
  active?: boolean;
  disabled?: boolean;
  onRun: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={toolbarStyles.overflowItem}
      disabled={props.disabled}
      onClick={props.onRun}
    >
      <span className={toolbarStyles.overflowItemIcon}>{props.icon}</span>
      <span className={toolbarStyles.overflowItemText}>{props.label}</span>
      <span className={toolbarStyles.overflowItemTrailing}>
        {props.meta ? <span className={toolbarStyles.overflowItemMeta}>{props.meta}</span> : null}
        {props.active ? <span className={toolbarStyles.overflowItemCheck}><Check size={14} /></span> : null}
      </span>
    </button>
  );
}

export function fuzzyIncludes(haystack: string, needle: string): boolean {
  if (haystack.includes(needle)) return true;
  let index = 0;
  for (const char of needle) {
    index = haystack.indexOf(char, index);
    if (index === -1) return false;
    index += 1;
  }
  return true;
}

export function searchResultSubtitle(result: SearchResult): string {
  const entry = result.entry;
  const source = entry.location.kind === "remote"
    ? entry.location.remoteName ?? "Remote"
    : "Local";
  return `${source} · ${entry.kind} · ${entry.path}`;
}
