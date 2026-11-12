// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { FolderTree, X } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  IconButton,
  Pressable,
  Skeleton,
} from "@/shared/ui";
import { FileSearchOverlay } from "./FileSearchOverlay";
import { FileTree } from "./FileTree";
import { getFileTreeIconSvg } from "./fileIcons";
import { fileName, useFilesStore } from "./filesStore";
import { useTreePreferences } from "./treePreferences";
import "./files.css";

const EditorPane = lazy(() => import("../editor/EditorPane"));

const editorSkeleton = (
  <div className="grid gap-2 p-3" aria-hidden="true">
    <Skeleton className="h-4 w-2/3" />
    <Skeleton className="h-4 w-1/2" />
  </div>
);

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
    <div className="file-tabs" role="tablist" aria-label="Open files">
      <Pressable
        role="tab"
        className="file-tab"
        aria-selected={active === null}
        title="Files"
        onClick={() => activateFile(null)}
      >
        <FolderTree size={14} aria-hidden />
        <span className="file-tab-name">Files</span>
      </Pressable>
      {openFiles.map((path, index) => (
        <div
          key={path}
          className="file-tab"
          role="tab"
          aria-selected={active === path}
          data-dragging={dragging === path || undefined}
          draggable
          onDragStart={(event) => {
            setDragging(path);
            event.dataTransfer.effectAllowed = "move";
          }}
          onDragEnd={() => setDragging(null)}
          onDragOver={(event) => {
            if (dragging && dragging !== path) event.preventDefault();
          }}
          onDrop={(event) => {
            event.preventDefault();
            if (dragging) useFilesStore.getState().moveOpenFile(dragging, index);
            setDragging(null);
          }}
          onAuxClick={(event) => {
            if (event.button === 1) onClose(path);
          }}
        >
          <Pressable className="file-tab-main" title={path} onClick={() => activateFile(path)}>
            <span
              className="file-tree-icon"
              aria-hidden
              dangerouslySetInnerHTML={{ __html: getFileTreeIconSvg(fileName(path), false) }}
            />
            <span className="file-tab-name">{fileName(path)}</span>
            {dirty[path] ? <span className="file-tab-dirty" aria-label="Unsaved" /> : null}
          </Pressable>
          <IconButton label={`Close ${fileName(path)}`} size="2xs" onClick={() => onClose(path)}>
            <X aria-hidden />
          </IconButton>
        </div>
      ))}
    </div>
  );
}

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

  // The store still names the folder shown before; nothing shows until it follows this one.
  if (root !== folder) return editorSkeleton;

  return (
    <div className="files-panel">
      <FileTabs onClose={close} />
      <div className="files-panel-body">
        <div className="files-panel-view" hidden={active !== null}>
          <FileTree />
          {searchRoot ? <FileSearchOverlay searchRoot={searchRoot} /> : null}
        </div>
        {/* Open tabs stay mounted, so each keeps its draft, cursor and scroll. */}
        {openFiles.map((path) => (
          <div key={path} className="files-panel-view" hidden={active !== path}>
            <Suspense fallback={editorSkeleton}>
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
