import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { hasTauriInternals } from "@/shared/platform/tauri";

export interface WebDownload {
  id: string;
  url: string;
  path: string;
  fileName: string;
  spaceId: string;
  state: "in_progress" | "finished" | "failed" | "interrupted";
  error?: string | null;
  startedAt: number;
  finishedAt?: number | null;
  exists: boolean;
}

interface DownloadsState {
  items: WebDownload[];
  loaded: boolean;
  failed: boolean;
}

export const useWebDownloads = create<DownloadsState>(() => ({
  items: [],
  loaded: false,
  failed: false,
}));

let following = false;

export async function loadWebDownloads() {
  try {
    const items = await invoke<WebDownload[]>("browser_downloads_list");
    useWebDownloads.setState({ items, loaded: true, failed: false });
  } catch {
    useWebDownloads.setState({ loaded: true, failed: true });
  }
}

export function followWebDownloads() {
  if (following || !hasTauriInternals()) return;
  following = true;
  void loadWebDownloads();
  void listen<{ initiator?: string }>("misty://browser-download", ({ payload }) => {
    if (payload.initiator === "human") void loadWebDownloads();
  }).catch(() => {
    following = false;
  });
}

export const openDownload = (id: string) => invoke("browser_download_open", { request: { id } });

export async function clearDownloads() {
  await invoke("browser_downloads_clear").catch(() => undefined);
  await loadWebDownloads();
}

export const downloadsRunning = (items: WebDownload[]) =>
  items.filter((item) => item.state === "in_progress").length;
