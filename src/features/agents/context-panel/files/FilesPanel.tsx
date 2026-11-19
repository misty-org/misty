// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { FolderTree, X } from "lucide-react";
import { useEffect, useState, type DragEvent, type MouseEvent } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  cn,
  IconButton,
  Pressable,
  Surface,
  Text,
  Tooltip,
  lazyTool,
  ToolSuspense,
} from "@/shared/ui";
import { FileSearchOverlay } from "./FileSearchOverlay";
import { FileTree } from "./FileTree";
import { getFileTreeIconSvg } from "./fileIcons";
import { fileName, useFilesStore } from "./filesStore";
import { useTreePreferences } from "./treePreferences";

const EditorPane = lazyTool(() => import("../editor/EditorPane"));

/** A tab in the strip over the panel: 28px, its icon and name in the caption role. */
const tabClass = "flex h-7 min-w-0 max-w-45 flex-none items-center gap-1 text-caption";
/**
 * A tab as the Code page draws it: a square block the strip's full 40px tall, ruled off from the
 * next by a hairline, so the editor's tabs never pass for the window's rounded ones. The open one
 * takes the page's fill and drops its bottom rule, running on into the editor under it.
 */
const blockClass =
  "flex h-full min-w-0 max-w-48 flex-none items-center gap-1 border-r text-caption";
/** What a tab shows: its icon and name, bright while it is the one open. */
const tabContentClass = "flex h-full min-w-0 flex-1 items-center";

/** The strip over the panel: the tree, then each open file. Tabs close, reorder by dragging,
 * and are kept per folder. The Code page, whose tree has a column of its own, leaves out the
 * tree's tab (`withTree`) and draws them as square blocks (`blocks`). */
export function FileTabs({
  onClose,
  withTree = true,
  blocks = false,
}: {
  onClose(path: string): void;
  withTree?: boolean;
  /** Square, ruled-off tabs on the window's chrome, for the Code page's editor. */
  blocks?: boolean;
}) {
  const openFiles = useFilesStore((state) => state.openFiles);
  const active = useFilesStore((state) => state.activeFilePath);
  const dirty = useFilesStore((state) => state.dirtyPaths);
  const activateFile = useFilesStore((state) => state.activateFile);
  const [dragging, setDragging] = useState<string | null>(null);
  if (openFiles.length === 0) return null;
  const strip = (
    // Tabs read muted and brighten under the pointer (the wash); the open one is bright.
    <Text
      bare
      as="div"
      tone="muted"
      className={
        blocks
          ? "flex h-10 overflow-x-auto [scrollbar-width:none]"
          : "flex flex-none gap-1 overflow-x-auto border-b px-2 py-1 [scrollbar-width:none]"
      }
      role="tablist"
      aria-label="Open files"
    >
      {withTree ? (
        <Surface
          as={Pressable}
          tone="none"
          radius="md"
          wash="control"
          role="tab"
          data-selected={active === null || undefined}
          className={cn(tabClass, "px-2")}
          aria-selected={active === null}
          onClick={() => activateFile(null)}
        >
          <Text
            bare
            tone={active === null ? "bright" : undefined}
            className={cn(tabContentClass, "gap-1")}
          >
            <FolderTree aria-hidden />
            <Text className="min-w-0">Files</Text>
          </Text>
        </Surface>
      ) : null}
      {openFiles.map((path, index) => (
        <Surface
          key={path}
          tone={blocks && active === path ? "page" : "none"}
          radius={blocks ? "none" : "md"}
          wash={blocks && active === path ? undefined : "control"}
          className={cn(
            blocks ? blockClass : tabClass,
            blocks ? "pr-1 pl-3" : "pr-1 pl-2",
            blocks && active !== path && "border-b",
            "data-[dragging]:opacity-50",
          )}
          role="tab"
          aria-selected={active === path}
          data-selected={active === path || undefined}
          data-dragging={dragging === path || undefined}
          draggable
          onDragStart={(event: DragEvent<HTMLElement>) => {
            setDragging(path);
            event.dataTransfer.effectAllowed = "move";
          }}
          onDragEnd={() => setDragging(null)}
          onDragOver={(event: DragEvent<HTMLElement>) => {
            if (dragging && dragging !== path) event.preventDefault();
          }}
          onDrop={(event: DragEvent<HTMLElement>) => {
            event.preventDefault();
            if (dragging) useFilesStore.getState().moveOpenFile(dragging, index);
            setDragging(null);
          }}
          onAuxClick={(event: MouseEvent<HTMLElement>) => {
            if (event.button === 1) onClose(path);
          }}
        >
          <Tooltip content={path}>
            <Pressable
              className="flex h-full min-w-0 flex-1 items-center"
              onClick={() => activateFile(path)}
            >
              <Text
                bare
                tone={active === path ? "bright" : undefined}
                className={cn(tabContentClass, "gap-2")}
              >
                <Text
                  bare
                  tone="muted"
                  className="inline-flex size-4 flex-none items-center justify-center"
                  aria-hidden
                  dangerouslySetInnerHTML={{ __html: getFileTreeIconSvg(fileName(path), false) }}
                />
                <Text className="min-w-0">{fileName(path)}</Text>
                {dirty[path] ? (
                  <Text
                    bare
                    tone="muted"
                    className="size-1.5 flex-none rounded-full bg-current"
                    aria-label="Unsaved"
                  />
                ) : null}
              </Text>
            </Pressable>
          </Tooltip>
          <IconButton label={`Close ${fileName(path)}`} size="sm" onClick={() => onClose(path)}>
            <X aria-hidden />
          </IconButton>
        </Surface>
      ))}
      {/* The rest of the strip keeps the rule under the tabs, out to the editor's edge. */}
      {blocks ? <div aria-hidden className="min-w-0 flex-1 border-b" /> : null}
    </Text>
  );
  // On the Code page the strip sits on the window's chrome, so the open block in the page's fill
  // stands out from the rest.
  return blocks ? (
    <Surface tone="chrome" className="flex-none">
      {strip}
    </Surface>
  ) : (
    strip
  );
}

/** The tree, or one open file; the others stay mounted but hidden. */
const viewClass = "relative flex min-h-0 min-w-0 flex-1 flex-col";

/**
 * The folder's files: a tree, and the files opened from it as tabs, each in a code editor with
 * Markdown and HTML previews and find and replace. The search overlay covers the tree while open.
 */
export function FilesPanel({ folder }: { folder: string }) {
  const root = useFilesStore((state) => state.root);
  const setRoot = useFilesStore((state) => state.setRoot);
  const searchRoot = useFilesStore((state) => state.searchRoot);
  const openFiles = useFilesStore((state) => state.openFiles);
  const active = useFilesStore((state) => state.activeFilePath);
  const [closing, setClosing] = useState<string | null>(null);

  useEffect(() => setRoot(folder), [folder, setRoot]);
  useEffect(() => {
    void useTreePreferences.getState().hydrate();
  }, []);

  const close = (path: string) => {
    if (useFilesStore.getState().dirtyPaths[path]) setClosing(path);
    else useFilesStore.getState().closeFile(path);
  };

  // The store still names the folder shown before, for the one frame until it follows this one.
  if (root !== folder) return null;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <FileTabs onClose={close} />
      <div className="relative flex min-h-0 flex-1">
        <div className={viewClass} hidden={active !== null}>
          <FileTree />
          {searchRoot ? <FileSearchOverlay searchRoot={searchRoot} /> : null}
        </div>
        {/* Open tabs stay mounted, so each keeps its draft, cursor and scroll. */}
        {openFiles.map((path) => (
          <div key={path} className={viewClass} hidden={active !== path}>
            <ToolSuspense tool="code editor">
              <EditorPane path={path} />
            </ToolSuspense>
          </div>
        ))}
      </div>
      <CloseFileDialog path={closing} onDone={() => setClosing(null)} />
    </div>
  );
}

/** Asks before closing a tab with unsaved edits; `path` null keeps it shut. */
export function CloseFileDialog({ path, onDone }: { path: string | null; onDone(): void }) {
  return (
    <AlertDialog open={path !== null} onOpenChange={(open) => !open && onDone()}>
      <AlertDialogContent className="max-w-sm">
        <AlertDialogHeader>
          <AlertDialogTitle>Close without saving?</AlertDialogTitle>
          <AlertDialogDescription className="break-words">
            {path ? `Your edits to “${fileName(path)}” will be lost.` : ""}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep editing</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              if (path) useFilesStore.getState().closeFile(path);
              onDone();
            }}
          >
            Close
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
