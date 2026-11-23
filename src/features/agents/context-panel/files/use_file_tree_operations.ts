// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { errorText } from "../project_api";
import { filesApi, type ClipboardFileSnapshot } from "./files_api";
import { useFileIndex } from "./file_index";
import { joinPath, parentPath, useFilesStore, type TreeClipboard } from "./files_store";
import { choosePasteSource, type PasteSource } from "./paste_source";
import { sendPathToComposer } from "./send_to_composer";
import type { VisibleNode } from "./visible_nodes";

export interface FileTreeMenuTarget {
  path: string;
  isDir: boolean;
}

export interface PromptState {
  kind: "newFile" | "newFolder" | "rename";
  path: string;
  isDir: boolean;
}

interface FileTreeOperations {
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
  revealPath(path: string): void;
  copyPathOf(path: string): void;
  startTrash(): void;
  submitPrompt(name: string): void;
  cancelPrompt(): void;
  confirmTrash(): void;
  cancelTrash(): void;
  dismissNotice(): void;
}

async function readPasteSource(item: TreeClipboard | null): Promise<PasteSource> {
  try {
    return choosePasteSource(await filesApi.clipboardSnapshot(), item);
  } catch (error) {
    if (item?.osChangeCount != null) {
      const count = await filesApi.clipboardChangeCount().catch(() => null);
      if (count === item.osChangeCount) return "tree";
    }
    throw error;
  }
}

export function useFileTreeOperations(): FileTreeOperations {
  const clipboard = useFilesStore((state) => state.clipboard);
  const root = useFilesStore((state) => state.root);
  const revealDir = useFilesStore((state) => state.revealDir);
  const invalidateDir = useFilesStore((state) => state.invalidateDir);
  const selectPath = useFilesStore((state) => state.selectPath);

  const copyIdRef = useRef(0);
  const clipboardWriteRef = useRef<Promise<void>>(Promise.resolve());
  const probeRef = useRef(0);
  const mountedRef = useRef(true);
  const [target, setTarget] = useState<FileTreeMenuTarget | null>(null);
  const [prompt, setPrompt] = useState<PromptState | null>(null);
  const [trashTarget, setTrashTarget] = useState<FileTreeMenuTarget | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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
      const probe = ++probeRef.current;
      setMenuSnapshot(null);
      void clipboardWriteRef.current
        .then(() => filesApi.clipboardSnapshot())
        .then((snapshot) => {
          if (mountedRef.current && probeRef.current === probe) setMenuSnapshot(snapshot);
        })
        .catch(() => undefined);
    },
    [selectPath],
  );

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
          await clipboardWriteRef.current;
          source = await readPasteSource(useFilesStore.getState().clipboard);
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
    clipboardWriteRef.current = clipboardWriteRef.current.then(async () => {
      if (copyIdRef.current !== id) return;
      const osChangeCount = await filesApi.clipboardSetFiles([item.path]).catch(() => undefined);
      if (osChangeCount === undefined) return;
      const store = useFilesStore.getState();
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
    revealPath: useCallback((path: string) => void filesApi.reveal(path).catch(failed), [failed]),
    copyPathOf: useCallback(
      (path: string) => void navigator.clipboard.writeText(path).catch(failed),
      [failed],
    ),
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
