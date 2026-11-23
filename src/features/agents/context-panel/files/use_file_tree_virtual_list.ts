// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { useEffect, useMemo, useRef } from "react";
import { measureElement as defaultMeasureElement, useVirtualizer } from "@tanstack/react-virtual";
import { joinPath, useFilesStore } from "./files_store";
import { useTreePreferences } from "./tree_preferences";
import { buildVisibleNodes, type VisibleNode } from "./visible_nodes";
import { uiPx } from "@misty/ui";

export function useFileTreeVirtualList({ hideRoot = false }: { hideRoot?: boolean } = {}) {
  const root = useFilesStore((s) => s.root);
  const children = useFilesStore((s) => s.children);
  const expanded = useFilesStore((s) => s.expanded);
  const loadingDirs = useFilesStore((s) => s.loadingDirs);
  const dirErrors = useFilesStore((s) => s.dirErrors);
  const repositories = useFilesStore((s) => s.repositories);
  const fileColors = useFilesStore((s) => s.fileColors);
  const hideIgnored = useTreePreferences((s) => s.hideIgnored);
  const ensureDir = useFilesStore((s) => s.ensureDir);
  const toggleDir = useFilesStore((s) => s.toggleDir);

  useEffect(() => {
    if (root) {
      void ensureDir(root);
      if (!useFilesStore.getState().expanded[root]) void toggleDir(root);
    }
  }, [root, ensureDir, toggleDir]);

  useEffect(() => {
    if (!root || !expanded[root]) return;
    const visit = (dir: string) => {
      for (const entry of children[dir] ?? []) {
        if (!entry.isDir || (hideIgnored && entry.ignored)) continue;
        const path = joinPath(dir, entry.name);
        if (!expanded[path]) continue;
        if (children[path]) visit(path);
        else if (!loadingDirs[path] && !dirErrors[path]) void ensureDir(path);
      }
    };
    visit(root);
  }, [root, expanded, children, loadingDirs, dirErrors, hideIgnored, ensureDir]);

  const visible = useMemo<VisibleNode[]>(() => {
    const nodes = buildVisibleNodes({
      root,
      children,
      expanded,
      loadingDirs,
      dirErrors,
      repositories,
      fileColors,
      hideIgnored,
    });
    return hideRoot
      ? nodes
          .filter((node) => node.path !== root)
          .map((node) => ({ ...node, depth: node.depth - 1 }))
      : nodes;
  }, [
    children,
    expanded,
    loadingDirs,
    dirErrors,
    repositories,
    fileColors,
    root,
    hideIgnored,
    hideRoot,
  ]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => uiPx(28),
    overscan: 10,
    getItemKey: (index) => visible[index]?.path ?? index,
    measureElement: (el, entry, instance) => {
      const size = defaultMeasureElement(el, entry, instance);
      if (size > 0) return size;
      const index = instance.indexFromElement(el);
      return instance.itemSizeCache.get(instance.options.getItemKey(index)) ?? 28;
    },
  });

  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    let lastHeight = el.getBoundingClientRect().height;
    const ro = new ResizeObserver(() => {
      const height = el.getBoundingClientRect().height;
      if (lastHeight === 0 && height > 0) el.dispatchEvent(new Event("scroll"));
      lastHeight = height;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return { parentRef, virtualizer, visible };
}
