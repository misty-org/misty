// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { errorText } from "../projectApi";
import { filesApi, type ClipboardFileSnapshot } from "./filesApi";
import { useFileIndex } from "./fileIndex";
import { joinPath, parentPath, useFilesStore, type TreeClipboard } from "./filesStore";
import { choosePasteSource, type PasteSource } from "./pasteSource";
import { sendPathToComposer } from "./sendToComposer";
import type { VisibleNode } from "./visibleNodes";

export interface FileTreeMenuTarget {
  path: string;
  isDir: boolean;
}

export interface PromptState {
  kind: "newFile" | "newFolder" | "rename";
  /** The folder a new item goes in; the item itself for a rename. */
  path: string;
  isDir: boolean;
}

interface FileTreeOperations {
  /** Paste has something to paste, decided as Paste decides (`choosePasteSource`) from the
   * snapshot read when the menu opened: the tree's item while it is the newest copy, otherwise
   * the system clipboard's files. Before that read lands, or when it fails, the tree's item alone
   * enables it. */
  canPaste: boolean;
  target: FileTreeMenuTarget | null;
  prompt: PromptState | null;
  trashTarget: FileTreeMenuTarget | null;
  notice: string | null;
  openContextMenu(event: MouseEvent<HTMLElement>, node: VisibleNode): void;
  startNewFile(dir: string): void;
  startNewFolder(dir: string): void;
  copyItem(): void;
  paste(dir: string): void;
  duplicate(): void;
  startRename(): void;
  copyPath(): void;
  sendPath(): void;
  openInBrowser(): void;
  reveal(): void;
  startTrash(): void;
  submitPrompt(name: string): void;
  cancelPrompt(): void;
  confirmTrash(): void;
  cancelTrash(): void;
  dismissNotice(): void;
}

/** Which clipboard Paste copies from, given the tree's item as it stands. */
async function readPasteSource(item: TreeClipboard | null): Promise<PasteSource> {
  try {
    return choosePasteSource(await filesApi.clipboardSnapshot(), item);
  } catch (error) {
    // Another program holds the clipboard open (Windows). The change count needs no open: while
    // it still equals what this item's Copy recorded, nothing newer was copied anywhere.
    if (item?.osChangeCount != null) {
      const count = await filesApi.clipboardChangeCount().catch(() => null);
      if (count === item.osChangeCount) return "tree";
    }
    throw error;
  }
}

/**
 * The tree's right-click menu and what it does: who the menu is for, the name and confirm
 * dialogs, the notice a failure shows for a few seconds, and every action behind the entries.
 */
export function useFileTreeOperations(): FileTreeOperations {
  const clipboard = useFilesStore((state) => state.clipboard);
  const root = useFilesStore((state) => state.root);
  const revealDir = useFilesStore((state) => state.revealDir);
  const invalidateDir = useFilesStore((state) => state.invalidateDir);
  const selectPath = useFilesStore((state) => state.selectPath);

  const copyIdRef = useRef(0);
  /** The tail of the Copy writes in order; never rejects. */
  const clipboardWriteRef = useRef<Promise<void>>(Promise.resolve());
  const probeRef = useRef(0);
  const mountedRef = useRef(true);
  const [target, setTarget] = useState<FileTreeMenuTarget | null>(null);
  const [prompt, setPrompt] = useState<PromptState | null>(null);
  const [trashTarget, setTrashTarget] = useState<FileTreeMenuTarget | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** The clipboard snapshot read when the menu opened; null until that read lands or when it
   * failed. It only decides whether Paste is enabled: the paste reads the clipboard again. */
  const [menuSnapshot, setMenuSnapshot] = useState<ClipboardFileSnapshot | null>(null);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      copyIdRef.current += 1;
      probeRef.current += 1;
    };
  }, []);

  const failed = useCallback((error: unknown) => {
    if (mountedRef.current) setNotice(errorText(error));
  }, []);

  const changed = useCallback(() => {
    if (root) useFileIndex.getState().invalidate(root);
  }, [root]);

  const openContextMenu = useCallback(
    (_event: MouseEvent<HTMLElement>, node: VisibleNode) => {
      selectPath(node.path, node.isDir);
      setTarget({ path: node.path, isDir: node.isDir });
      // Only the latest menu may decide Paste.
      const probe = ++probeRef.current;
      setMenuSnapshot(null);
      // Like Paste, read only once the latest Copy's write settled: an earlier snapshot wouldn't
      // match the change count that Copy records.
      void clipboardWriteRef.current
        .then(() => filesApi.clipboardSnapshot())
        .then((snapshot) => {
          if (mountedRef.current && probeRef.current === probe) setMenuSnapshot(snapshot);
        })
        .catch(() => undefined);
    },
    [selectPath],
  );

  /** Reads the parent again, opens it and every folder above it (a merged row may hold closed
   * middle folders), and selects what the operation made so the person sees it. */
  const revealInTree = useCallback(
    async (dir: string, made: string | null, isDir: boolean) => {
      if (dir) await revealDir(dir);
      await invalidateDir(dir);
      if (made) selectPath(made, isDir);
      changed();
    },
    [revealDir, invalidateDir, selectPath, changed],
  );

  const submitPrompt = useCallback(
    async (name: string) => {
      const asked = prompt;
      setPrompt(null);
      if (!asked) return;
      const trimmed = name.trim();
      if (!trimmed) return;
      if (trimmed.includes("/") || trimmed.includes("\\")) {
        setNotice("A name can't hold a slash.");
        return;
      }
      try {
        if (asked.kind === "rename") {
          const parent = parentPath(asked.path);
          const to = joinPath(parent, trimmed);
          if (to !== asked.path) {
            await filesApi.rename(asked.path, to);
            useFilesStore.getState().remapTreePath(asked.path, to);
            await invalidateDir(parent);
            selectPath(to, asked.isDir);
            changed();
          }
          return;
        }
        const made = joinPath(asked.path, trimmed);
        if (asked.kind === "newFile") {
          await filesApi.createFile(made);
          await revealInTree(asked.path, made, false);
          void useFilesStore.getState().openFile(made);
        } else {
          await filesApi.createDir(made);
          await revealInTree(asked.path, made, true);
        }
      } catch (error) {
        failed(error);
      }
    },
    [prompt, invalidateDir, selectPath, revealInTree, failed, changed],
  );

  const confirmTrash = useCallback(async () => {
    const item = trashTarget;
    setTrashTarget(null);
    if (!item) return;
    try {
      await filesApi.trash(item.path);
      useFilesStore.getState().removeTreePath(item.path);
      await invalidateDir(parentPath(item.path));
      changed();
    } catch (error) {
      failed(error);
    }
  }, [trashTarget, invalidateDir, failed, changed]);

  const paste = useCallback(
    async (dir: string) => {
      try {
        let source: PasteSource;
        for (;;) {
          const copyId = copyIdRef.current;
          // The latest Copy's write must settle and record its change count first.
          await clipboardWriteRef.current;
          // The native side reads its own snapshot to paste; no window-named source path ever
          // reaches that command.
          source = await readPasteSource(useFilesStore.getState().clipboard);
          // A Copy that came in meanwhile changed both clipboards: decide again.
          if (copyIdRef.current === copyId) break;
        }
        if (!mountedRef.current) return;
        const item = useFilesStore.getState().clipboard;
        if (source === "tree" && item) {
          const result = await filesApi.paste(item.path, dir);
          await revealInTree(dir, result.path, result.isDir);
          return;
        }
        if (source === "system") {
          const { created, failed: refused } = await filesApi.pasteClipboard(dir);
          if (created.length > 0) {
            const last = created[created.length - 1];
            await revealInTree(dir, last.path, last.isDir);
          }
          if (!mountedRef.current) return;
          if (refused.length > 0) setNotice(refused.join("; "));
          else if (created.length === 0) setNotice("Nothing to paste.");
          return;
        }
        setNotice("Nothing to paste.");
      } catch (error) {
        failed(error);
      }
    },
    [revealInTree, failed],
  );

  const duplicate = useCallback(async () => {
    if (!target) return;
    try {
      const result = await filesApi.duplicate(target.path);
      await revealInTree(parentPath(target.path), result.path, result.isDir);
    } catch (error) {
      failed(error);
    }
  }, [target, revealInTree, failed]);

  const copyItem = useCallback(() => {
    if (!target) return;
    const item: TreeClipboard = { path: target.path, isDir: target.isDir };
    const id = ++copyIdRef.current;
    useFilesStore.getState().setClipboard(item);
    // Writes go in order: a late write for an older Copy must not replace the newer item.
    clipboardWriteRef.current = clipboardWriteRef.current.then(async () => {
      if (copyIdRef.current !== id) return;
      // A refused write isn't the tree's failure: the change count it returns still tells
      // Paste whether this item is the newest copy.
      const osChangeCount = await filesApi.clipboardSetFiles([item.path]).catch(() => undefined);
      if (osChangeCount === undefined) return;
      const store = useFilesStore.getState();
      // A newer Copy replaced the item meanwhile; it records its own.
      if (store.clipboard === item) store.setClipboard({ ...item, osChangeCount });
    });
  }, [target]);

  const copyPath = useCallback(() => {
    if (!target) return;
    void navigator.clipboard.writeText(target.path).catch(failed);
  }, [target, failed]);

  const sendPath = useCallback(() => {
    if (target && root) sendPathToComposer(root, target.path, target.isDir);
  }, [target, root]);

  const openInBrowser = useCallback(() => {
    if (target) void filesApi.openInBrowser(target.path).catch(failed);
  }, [target, failed]);

  const reveal = useCallback(() => {
    if (target) void filesApi.reveal(target.path).catch(failed);
  }, [target, failed]);

  return {
    canPaste: menuSnapshot
      ? choosePasteSource(menuSnapshot, clipboard) !== "none"
      : clipboard !== null,
    target,
    prompt,
    trashTarget,
    notice,
    openContextMenu,
    startNewFile: useCallback(
      (dir: string) => setPrompt({ kind: "newFile", path: dir, isDir: true }),
      [],
    ),
    startNewFolder: useCallback(
      (dir: string) => setPrompt({ kind: "newFolder", path: dir, isDir: true }),
      [],
    ),
    copyItem,
    paste: useCallback((dir: string) => void paste(dir), [paste]),
    duplicate: useCallback(() => void duplicate(), [duplicate]),
    startRename: useCallback(() => {
      if (target && target.path !== root) {
        setPrompt({ kind: "rename", path: target.path, isDir: target.isDir });
      }
    }, [target, root]),
    copyPath,
    sendPath,
    openInBrowser,
    reveal,
    startTrash: useCallback(() => {
      if (target && target.path !== root) setTrashTarget(target);
    }, [target, root]),
    submitPrompt: useCallback((name: string) => void submitPrompt(name), [submitPrompt]),
    cancelPrompt: useCallback(() => setPrompt(null), []),
    confirmTrash: useCallback(() => void confirmTrash(), [confirmTrash]),
    cancelTrash: useCallback(() => setTrashTarget(null), []),
    dismissNotice: useCallback(() => setNotice(null), []),
  };
}
