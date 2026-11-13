// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { FolderTree, X } from "lucide-react";
import { lazy, Suspense, useEffect, useState, type DragEvent, type MouseEvent } from "react";
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
} from "@/shared/ui";
import { EditorSkeleton } from "../PanelSkeletons";
import { FileSearchOverlay } from "./FileSearchOverlay";
import { FileTree } from "./FileTree";
import { getFileTreeIconSvg } from "./fileIcons";
import { fileName, useFilesStore } from "./filesStore";
import { useTreePreferences } from "./treePreferences";

const EditorPane = lazy(() => import("../editor/EditorPane"));

/** A tab in the strip over the panel: 28px, its icon and name in the caption role. */
const tabClass = "flex h-7 min-w-0 max-w-45 flex-none items-center gap-1 text-caption";
/** What a tab shows: its icon and name, bright while it is the one open. */
const tabContentClass = "flex h-full min-w-0 flex-1 items-center";

/** The strip over the panel: the tree, then each open file. Tabs close, reorder by dragging,
 * and are kept per folder. */
function FileTabs({ onClose }: { onClose(path: string): void }) {
  const openFiles = useFilesStore((state) => state.openFiles);
  const active = useFilesStore((state) => state.activeFilePath);
  const dirty = useFilesStore((state) => state.dirtyPaths);
  const activateFile = useFilesStore((state) => state.activateFile);
  const [dragging, setDragging] = useState<string | null>(null);
  if (openFiles.length === 0) return null;
  return (
    // Tabs read muted and brighten under the pointer (the wash); the open one is bright.
    <Text
      bare
      as="div"
      tone="muted"
      className="flex flex-none gap-1 overflow-x-auto border-b px-2 py-1 [scrollbar-width:none]"
      role="tablist"
      aria-label="Open files"
    >
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
      {openFiles.map((path, index) => (
        <Surface
          key={path}
          tone="none"
          radius="md"
          wash="control"
          className={cn(tabClass, "pr-1 pl-2 data-[dragging]:opacity-50")}
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
    </Text>
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
            <Suspense fallback={<EditorSkeleton path={path} />}>
              <EditorPane path={path} />
            </Suspense>
          </div>
        ))}
      </div>
      <AlertDialog open={closing !== null} onOpenChange={(open) => !open && setClosing(null)}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Close without saving?</AlertDialogTitle>
            <AlertDialogDescription className="break-words">
              {closing ? `Your edits to “${fileName(closing)}” will be lost.` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (closing) useFilesStore.getState().closeFile(closing);
                setClosing(null);
              }}
            >
              Close
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
