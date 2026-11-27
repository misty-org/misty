import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { invoke } from "@/shared/platform/native_invoke";
import { hasTauriInternals } from "@/shared/platform/tauri";

export interface FilePickOptions {
  title?: string;
  accept?: string | readonly string[];
  multiple?: boolean;
}

export interface PathPickOptions extends FilePickOptions {
  folders?: boolean;
  start?: string;
}

export type FilePickRequest =
  | { id: number; kind: "files"; options: FilePickOptions; answer(files: File[]): void }
  | {
      id: number;
      kind: "paths";
      options: PathPickOptions;
      answer(paths: string[]): void | Promise<void>;
    };

let asked = 0;

export const useFilePickRequest = create<{ request: FilePickRequest | null }>(() => ({
  request: null,
}));

export function acceptList(accept: FilePickOptions["accept"]): string[] {
  if (!accept) return [];
  const kinds = typeof accept === "string" ? accept.split(",") : accept;
  return kinds.map((kind) => kind.trim().toLowerCase()).filter(Boolean);
}

function cancelPending() {
  void useFilePickRequest.getState().request?.answer([]);
}

export function pickFiles(options: FilePickOptions = {}): Promise<File[]> {
  return new Promise((resolve) => {
    cancelPending();
    useFilePickRequest.setState({
      request: {
        id: ++asked,
        kind: "files",
        options,
        answer: (files) => {
          useFilePickRequest.setState({ request: null });
          resolve(files);
        },
      },
    });
  });
}

export async function pickFile(options: Omit<FilePickOptions, "multiple"> = {}) {
  const [file] = await pickFiles({ ...options, multiple: false });
  return file;
}

export function pickPaths(options: PathPickOptions = {}): Promise<string[]> {
  return new Promise((resolve) => {
    cancelPending();
    useFilePickRequest.setState({
      request: {
        id: ++asked,
        kind: "paths",
        options,
        answer: (paths) => {
          useFilePickRequest.setState({ request: null });
          resolve(paths);
        },
      },
    });
  });
}

const NATIVE_PICK_EVENT = "misty://file-pick";

interface NativePick {
  id: number;
  title: string;
  folders: boolean;
  multiple: boolean;
  accept: string[];
  start?: string;
}

export function listenForNativePicks(): () => void {
  if (!hasTauriInternals()) return () => undefined;
  const stop = listen<NativePick>(NATIVE_PICK_EVENT, ({ payload }) => {
    cancelPending();
    const request: FilePickRequest = {
      id: ++asked,
      kind: "paths",
      options: {
        title: payload.title,
        folders: payload.folders,
        multiple: payload.multiple,
        accept: payload.accept,
        start: payload.start,
      },
      answer: async (paths) => {
        try {
          await invoke<void>("files_pick_answer", { id: payload.id, paths });
        } catch (cause) {
          if (paths.length) throw cause;
        }
        if (useFilePickRequest.getState().request === request)
          useFilePickRequest.setState({ request: null });
      },
    };
    useFilePickRequest.setState({ request });
  });
  return () => void stop.then((unlisten) => unlisten());
}
