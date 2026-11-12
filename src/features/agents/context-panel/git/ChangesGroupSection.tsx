// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { Checkbox, Pressable } from "@/shared/ui";
import { buildGitTree, flattenGitTree } from "./git-tree";
import type { GitFileEntry, GitStatus } from "./gitApi";
import { DirectoryRow, FileRow } from "./GitTreeRow";

const ROW_HEIGHT = 32;

export const ChangesSummary = memo(function ChangesSummary(props: {
  status: GitStatus;
  selectedCount: number;
}) {
  const all = [...props.status.staged, ...props.status.unstaged, ...props.status.untracked];
  const added = all.reduce((sum, file) => sum + (file.additions ?? 0), 0);
  const removed = all.reduce((sum, file) => sum + (file.deletions ?? 0), 0);
  return (
    <div className="git-summary">
      <span className="git-summary-count">
        <span>
          {all.length} {all.length === 1 ? "change" : "changes"}
        </span>
        <span className="git-added">+{added}</span>
        <span className="git-removed">−{removed}</span>
      </span>
      {props.selectedCount > 0 ? (
        <span className="git-summary-selected">{props.selectedCount} ticked</span>
      ) : null}
    </div>
  );
});

export interface GroupSectionProps {
  scrollElement: HTMLDivElement | null;
  scrollOffset: RefObject<number>;
  title: string;
  entries: GitFileEntry[];
  viewMode: "flat" | "tree";
  selectedFiles: Set<string>;
  onToggleSelectFile: (path: string) => void;
  onToggleSelectMany: (paths: string[]) => void;
  groupActionLabel: string;
  onGroupAction: (files: string[]) => void;
  rowActionLabel: string;
  rowActionKind: "stage" | "unstage";
  onRowAction: (file: string) => void;
  /** Only the folder-side groups (unstaged and untracked) can throw changes away. */
  rowDiscardLabel?: string;
  onRowDiscard?: (file: string) => void;
  groupDiscardLabel?: string;
  onGroupDiscard?: (files: string[]) => void;
  onOpen: (file: string) => void;
  menu: (entry: GitFileEntry, row: ReactNode) => ReactNode;
  actionBusy: boolean;
  isNew?: boolean;
}

/** One group of files with its tick-all box and actions; long groups render only the rows in view. */
export const GroupSection = memo(function GroupSection(props: GroupSectionProps) {
  const { entries, viewMode, selectedFiles, scrollElement } = props;
  const [open, setOpen] = useState(true);
  const [collapsedDirIds, setCollapsedDirIds] = useState<Set<string>>(new Set());
  const listRef = useRef<HTMLUListElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  const toggleDirOpen = useCallback((id: string) => {
    setCollapsedDirIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const allPaths = useMemo(() => entries.map((entry) => entry.path), [entries]);
  const selectedCount = useMemo(
    () => allPaths.filter((path) => selectedFiles.has(path)).length,
    [allPaths, selectedFiles],
  );
  const groupChecked =
    selectedCount === 0 ? false : selectedCount === allPaths.length ? true : "indeterminate";
  const tree = useMemo(
    () => (viewMode === "tree" ? buildGitTree(entries) : []),
    [entries, viewMode],
  );
  const treeItems = useMemo(
    () => (viewMode === "tree" ? flattenGitTree(tree, collapsedDirIds) : []),
    [tree, collapsedDirIds, viewMode],
  );
  const itemCount = viewMode === "tree" ? treeItems.length : entries.length;
  const virtual = itemCount > 40;

  useLayoutEffect(() => {
    const scroller = scrollElement;
    if (!open || !virtual || !scroller) return;
    const measure = () => {
      if (!listRef.current) return;
      setScrollMargin(
        listRef.current.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top +
          scroller.scrollTop,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    for (const child of scroller.children) observer.observe(child);
    return () => observer.disconnect();
  }, [open, virtual, itemCount, scrollElement]);

  const getItemKey = useCallback(
    (index: number) =>
      viewMode === "tree"
        ? (treeItems[index]?.id ?? `item-${index}`)
        : (entries[index]?.path ?? `item-${index}`),
    [viewMode, treeItems, entries],
  );
  const virtualizer = useVirtualizer({
    count: itemCount,
    getScrollElement: () => scrollElement,
    estimateSize: () => ROW_HEIGHT,
    getItemKey,
    overscan: 5,
    scrollMargin,
    initialOffset: () => props.scrollOffset.current ?? 0,
    enabled: open && virtual,
  });

  if (!entries.length) return null;

  const rows = virtual
    ? virtualizer.getVirtualItems().map((item) => ({ ...item, key: String(item.key) }))
    : Array.from({ length: itemCount }, (_, index) => ({
        key: getItemKey(index),
        index,
        start: index * ROW_HEIGHT + scrollMargin,
        size: ROW_HEIGHT,
      }));

  return (
    <section aria-label={props.title}>
      <div className="git-group-head">
        <Pressable
          className="git-row-toggle"
          aria-expanded={open}
          aria-label={`${open ? "Collapse" : "Expand"} ${props.title}`}
          onClick={() => setOpen(!open)}
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </Pressable>
        <Checkbox
          checked={groupChecked}
          onCheckedChange={() => props.onToggleSelectMany(allPaths)}
          aria-label={props.title}
        />
        <Pressable className="git-group-title" onClick={() => setOpen(!open)}>
          <span>{props.title}</span>
          <span>{entries.length}</span>
        </Pressable>
        {props.groupDiscardLabel !== undefined && props.onGroupDiscard ? (
          <Pressable
            className="git-group-action"
            data-danger
            disabled={props.actionBusy}
            onClick={() => props.onGroupDiscard?.(allPaths)}
          >
            {props.groupDiscardLabel}
          </Pressable>
        ) : null}
        <Pressable
          className="git-group-action"
          disabled={props.actionBusy}
          onClick={() => props.onGroupAction(allPaths)}
        >
          {props.groupActionLabel}
        </Pressable>
      </div>
      {open ? (
        <ul ref={listRef} className="git-list" style={{ height: itemCount * ROW_HEIGHT }}>
          {rows.map((row) => {
            const style = {
              position: "absolute" as const,
              top: 0,
              left: 0,
              width: "100%",
              height: row.size,
              transform: `translateY(${row.start - scrollMargin}px)`,
            };
            if (viewMode === "tree") {
              const item = treeItems[row.index];
              if (!item) return null;
              const indent = 12 + item.depth * 16;
              if (item.type === "dir") {
                const all = item.allPaths.every((path) => selectedFiles.has(path));
                const some = !all && item.allPaths.some((path) => selectedFiles.has(path));
                return (
                  <DirectoryRow
                    key={row.key}
                    node={item}
                    style={style}
                    indent={indent}
                    isOpen={!collapsedDirIds.has(item.id)}
                    onToggleOpen={toggleDirOpen}
                    selectedState={all ? "all" : some ? "some" : "none"}
                    onToggleSelect={props.onToggleSelectMany}
                    actionLabel={props.rowActionLabel}
                    actionKind={props.rowActionKind}
                    onAction={props.onGroupAction}
                    discardLabel={props.rowDiscardLabel}
                    onDiscard={props.onGroupDiscard}
                    actionBusy={props.actionBusy}
                  />
                );
              }
              return (
                <FileRow
                  key={row.key}
                  entry={item.entry}
                  style={style}
                  indent={indent}
                  displayName={item.name}
                  isSelected={selectedFiles.has(item.path)}
                  onToggleSelect={props.onToggleSelectFile}
                  actionLabel={props.rowActionLabel}
                  actionKind={props.rowActionKind}
                  onAction={props.onRowAction}
                  discardLabel={props.rowDiscardLabel}
                  onDiscard={props.onRowDiscard}
                  onOpen={props.onOpen}
                  menu={props.menu}
                  actionBusy={props.actionBusy}
                  isNew={props.isNew}
                />
              );
            }
            const entry = entries[row.index];
            if (!entry) return null;
            return (
              <FileRow
                key={row.key}
                entry={entry}
                style={style}
                isSelected={selectedFiles.has(entry.path)}
                onToggleSelect={props.onToggleSelectFile}
                actionLabel={props.rowActionLabel}
                actionKind={props.rowActionKind}
                onAction={props.onRowAction}
                discardLabel={props.rowDiscardLabel}
                onDiscard={props.onRowDiscard}
                onOpen={props.onOpen}
                menu={props.menu}
                actionBusy={props.actionBusy}
                isNew={props.isNew}
              />
            );
          })}
        </ul>
      ) : null}
    </section>
  );
});
