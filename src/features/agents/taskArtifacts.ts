import { create } from "zustand";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { resolveRequiredApiBase } from "@/api/client";
import { useLocalExecution } from "./localExecution";

export interface TaskArtifact {
  id: string;
  taskId: string;
  agentId: string;
  spaceId: string;
  name: string;
  path: string;
  state: "pending" | "ready" | "failed";
  error?: string;
}
interface NativeDownload {
  downloadId: string;
  tabId: string;
  path: string;
  state: string;
  success: boolean;
  error?: string;
}
export const useTaskArtifacts = create<{ items: TaskArtifact[]; storageKey: string }>(() => ({
  items: [],
  storageKey: "",
}));
let listening: Promise<() => void> | undefined;
export async function trackTaskArtifacts(accountId: string) {
  const base = await resolveRequiredApiBase();
  const storageKey = `misty:agent-artifacts:v1:${encodeURIComponent(base)}:${accountId}`;
  if (useTaskArtifacts.getState().storageKey !== storageKey) {
    let items: TaskArtifact[] = [];
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
      if (Array.isArray(saved))
        items = saved
          .filter((item) => item && typeof item.id === "string" && typeof item.path === "string")
          .map((item) =>
            item.state === "pending"
              ? {
                  ...item,
                  state: "failed",
                  error: "Download was interrupted. Verify the file before trying again.",
                }
              : item,
          );
    } catch {
      /* No earlier local results. */
    }
    useTaskArtifacts.setState({ items, storageKey });
  }
  listening ??= getCurrentWindow().listen<NativeDownload>(
    "misty://browser-download",
    ({ payload }) => {
      const execution = useLocalExecution.getState().execution;
      const state = useTaskArtifacts.getState();
      const previous = state.items.find((item) => item.id === payload.downloadId);
      if (!previous && (!execution || !execution.views.includes(payload.tabId))) return;
      const artifact: TaskArtifact = {
        ...(previous ?? {
          id: payload.downloadId,
          taskId: execution!.taskId,
          agentId: execution!.agentId,
          spaceId: execution!.spaceId,
        }),
        name: payload.path.split(/[\\/]/).pop() || "Download",
        path: payload.path,
        state:
          payload.state === "finished" && payload.success
            ? "ready"
            : payload.state === "requested"
              ? "pending"
              : "failed",
        error: payload.error,
      };
      const items = [artifact, ...state.items.filter((item) => item.id !== artifact.id)].slice(
        0,
        200,
      );
      useTaskArtifacts.setState({ items });
      // Keep results scoped to deployment/account and available after closing a worker.
      // Merge other windows' receipts rather than replacing their task results.
      try {
        const stored: TaskArtifact[] = JSON.parse(localStorage.getItem(state.storageKey) ?? "[]");
        localStorage.setItem(
          state.storageKey,
          JSON.stringify(
            [
              ...items,
              ...stored.filter((item) => !items.some((current) => current.id === item.id)),
            ].slice(0, 200),
          ),
        );
      } catch {
        /* Live receipts remain available if storage is full. */
      }
    },
  );
  await listening;
}
