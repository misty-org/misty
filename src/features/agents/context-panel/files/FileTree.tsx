// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  ContextMenu,
  ContextMenuTrigger,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Text,
  useNotice,
} from "@misty/ui";
import { FileTreeSkeleton } from "../PanelSkeletons";
import { FileTreeContextMenu } from "./FileTreeContextMenu";
import { TreeChildErrorRow, TreeChildRowsSkeleton, TreeRow } from "./FileTreeRow";
import { FileTreeToolbar, type FileTreeToolbarOptions } from "./FileTreeToolbar";
import { fileName, useFilesStore } from "./files_store";
import { sendPathToComposer } from "./send_to_composer";
import { COLLAPSE_ALL_SHORTCUT, EXPAND_LOADED_SHORTCUT } from "./tree_shortcuts";
import { useFileTreeOperations, type PromptState } from "./use_file_tree_operations";
import { useFileTreeVirtualList } from "./use_file_tree_virtual_list";
import type { VisibleNode } from "./visible_nodes";

function matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.split("+");
  const key = parts.pop() ?? "";
  return (
    event.key.toLowerCase() === key &&
    event.altKey === parts.includes("alt") &&
    event.shiftKey === parts.includes("shift") &&
    (event.metaKey || event.ctrlKey) === (parts.includes("mod") || parts.includes("ctrl"))
  );
}

function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

const titles: Record<PromptState["kind"], string> = {
  newFile: "New file",
  newFolder: "New folder",
  rename: "Rename",
};

function NameDialog(props: {
  prompt: PromptState | null;
  onSubmit(name: string): void;
  onCancel(): void;
}) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!props.prompt) return;
    setName(props.prompt.kind === "rename" ? fileName(props.prompt.path) : "");
  }, [props.prompt]);
  return (
    <Dialog open={props.prompt !== null} onOpenChange={(open) => !open && props.onCancel()}>
      <DialogContent
        className="max-w-sm"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          const input = inputRef.current;
          if (!input) return;
          input.focus();
          const dot = input.value.lastIndexOf(".");
          input.setSelectionRange(
            0,
            props.prompt?.kind === "rename" && dot > 0 ? dot : input.value.length,
          );
        }}
      >
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            props.onSubmit(name);
          }}
        >
          <DialogHeader>
            <DialogTitle>{props.prompt ? titles[props.prompt.kind] : ""}</DialogTitle>
          </DialogHeader>
          <Input
            ref={inputRef}
            aria-label="Name"
            value={name}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            onChange={(event) => setName(event.target.value)}
          />
          <DialogFooter>
            <Button type="button" size="lg" onClick={props.onCancel}>
              Cancel
            </Button>
            <Button type="submit" size="lg" disabled={!name.trim()}>
              {props.prompt?.kind === "rename" ? "Rename" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function FileTree({ toolbar }: { toolbar?: FileTreeToolbarOptions } = {}) {
  const hideRoot = Boolean(toolbar);
  const { parentRef, virtualizer, visible } = useFileTreeVirtualList({ hideRoot });
  const ops = useFileTreeOperations();
  useNotice(Boolean(ops.notice), {
    message: ops.notice ?? "",
    tone: "error",
    onDismiss: ops.dismissNotice,
  });
  const root = useFilesStore((state) => state.root);
  const dirErrors = useFilesStore((state) => state.dirErrors);
  const loadingDirs = useFilesStore((state) => state.loadingDirs);
  const selectedPath = useFilesStore((state) => state.selectedPath);
  const ensureDir = useFilesStore((state) => state.ensureDir);
  const toggleCompactDir = useFilesStore((state) => state.toggleCompactDir);
  const selectPath = useFilesStore((state) => state.selectPath);
  const openFile = useFilesStore((state) => state.openFile);
  const rowHit = useRef(false);
  const reveal = useRef<string | null>(null);
  useEffect(() => {
    reveal.current = selectedPath;
  }, [selectedPath]);
  useEffect(() => {
    const target = reveal.current;
    if (!target) return;
    const index = visible.findIndex(
      (node) => node.path === target || node.compactPaths?.includes(target),
    );
    if (index < 0) return;
    reveal.current = null;
    virtualizer.scrollToIndex(index, { align: "auto" });
  }, [selectedPath, visible, virtualizer]);

  const handleMention = useCallback(
    (path: string, isDir: boolean) => sendPathToComposer(root, path, isDir),
    [root],
  );
  const handleRowMenu = useCallback(
    (event: MouseEvent<HTMLElement>, node: VisibleNode) => {
      rowHit.current = true;
      ops.openContextMenu(event, node);
    },
    [ops],
  );

  const rootError = root ? dirErrors[root] : undefined;
  const rootLoading = root ? !!loadingDirs[root] : false;

  let body;
  if (rootError) {
    body = (
      <Text
        bare
        as="div"
        size="caption"
        tone="removed"
        className="flex flex-col items-start gap-2 px-3 py-2 break-all"
      >
        <p>{rootError}</p>
        <Button size="sm" variant="secondary" onClick={() => void ensureDir(root)}>
          Try again
        </Button>
      </Text>
    );
  } else if (rootLoading && visible.length <= (hideRoot ? 0 : 1)) {
    body = <FileTreeSkeleton />;
  } else {
    body = (
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((item) => {
          const node = visible[item.index];
          return (
            <div
              key={node.path}
              data-index={item.index}
              ref={virtualizer.measureElement}
              className="absolute top-0 left-0 w-full px-1"
              style={{ transform: `translateY(${item.start}px)` }}
            >
              <TreeRow
                node={node}
                selected={selectedPath === node.path}
                isRoot={node.path === root}
                onToggleDir={toggleCompactDir}
                onOpenFile={openFile}
                onSelectDir={selectPath}
                onContextMenu={handleRowMenu}
                onMention={handleMention}
              />
              {node.isDir && node.expanded && node.path !== root ? (
                node.loading ? (
                  <TreeChildRowsSkeleton depth={node.depth + 1} label={node.name} />
                ) : node.error ? (
                  <TreeChildErrorRow
                    depth={node.depth + 1}
                    error={node.error}
                    onRetry={() => void ensureDir(node.path)}
                  />
                ) : null
              ) : null}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div
      tabIndex={-1}
      className="relative flex min-h-0 flex-1 flex-col outline-none"
      role="tree"
      aria-label="Files"
      onKeyDown={(event) => {
        if (isEditable(event.target)) return;
        if (matchesShortcut(event.nativeEvent, EXPAND_LOADED_SHORTCUT)) {
          useFilesStore.getState().expandLoadedDirs();
        } else if (matchesShortcut(event.nativeEvent, COLLAPSE_ALL_SHORTCUT)) {
          useFilesStore.getState().collapseAllDirs();
        } else {
          return;
        }
        event.preventDefault();
      }}
    >
      {toolbar && root ? (
        <FileTreeToolbar
          root={root}
          options={toolbar}
          onNewFile={ops.startNewFile}
          onNewFolder={ops.startNewFolder}
          onReveal={ops.revealPath}
          onCopyPath={ops.copyPathOf}
        />
      ) : null}
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={parentRef}
            className="min-h-0 flex-1 overflow-auto py-1"
            onContextMenu={(event) => {
              if (!rowHit.current && root) {
                ops.openContextMenu(event, {
                  name: fileName(root),
                  path: root,
                  isDir: true,
                  size: 0,
                  mtimeMs: 0,
                  depth: 0,
                  expanded: true,
                  loading: false,
                });
              }
              rowHit.current = false;
            }}
          >
            {body}
          </div>
        </ContextMenuTrigger>
        {ops.target ? (
          <FileTreeContextMenu
            target={ops.target}
            isRoot={ops.target.path === root}
            pasteDisabled={!ops.canPaste}
            onNewFile={ops.startNewFile}
            onNewFolder={ops.startNewFolder}
            onSearchFiles={(dir) => useFilesStore.getState().openSearch(dir, "files")}
            onSearchText={(dir) => useFilesStore.getState().openSearch(dir, "text")}
            onCopy={ops.copyItem}
            onPaste={ops.paste}
            onDuplicate={ops.duplicate}
            onRename={ops.startRename}
            onCopyPath={ops.copyPath}
            onSendPath={ops.sendPath}
            onOpenInBrowser={ops.openInBrowser}
            onReveal={ops.reveal}
            onTrash={ops.startTrash}
          />
        ) : null}
      </ContextMenu>
      <NameDialog prompt={ops.prompt} onSubmit={ops.submitPrompt} onCancel={ops.cancelPrompt} />
      <AlertDialog
        open={ops.trashTarget !== null}
        onOpenChange={(open) => !open && ops.cancelTrash()}
      >
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Move to trash?</AlertDialogTitle>
            <AlertDialogDescription className="break-words">
              {ops.trashTarget
                ? ops.trashTarget.isDir
                  ? `“${fileName(ops.trashTarget.path)}” and everything in it will be moved to the trash.`
                  : `“${fileName(ops.trashTarget.path)}” will be moved to the trash.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={ops.confirmTrash}>Move to trash</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
