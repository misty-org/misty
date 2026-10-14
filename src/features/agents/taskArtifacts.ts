import { create } from "zustand";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useLocalExecution } from "./localExecution";
import { saveAgentArtifact } from "./agentArtifacts";

/**
 * Files an agent downloads while it works. Each finished download is saved to
 * the agent's Space as a Library item with the agent's provenance, so it shows
 * up there on every computer. This list only tracks this session's progress.
 */
export interface TaskArtifact {
  id: string;
  taskId: string;
  agentId: string;
  name: string;
  path: string;
  state: "downloading" | "saving" | "saved" | "failed";
  /** The file is on this computer, whether or not the Space has it yet. */
  downloaded: boolean;
  spaceName?: string;
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
export const useTaskArtifacts = create<{ items: TaskArtifact[]; accountId: string }>(() => ({
  items: [],
  accountId: "",
}));

function put(artifact: TaskArtifact) {
  const items = useTaskArtifacts.getState().items;
  useTaskArtifacts.setState({
    items: [artifact, ...items.filter((item) => item.id !== artifact.id)].slice(0, 200),
  });
}

function patch(id: string, change: Partial<TaskArtifact>) {
  useTaskArtifacts.setState({
    items: useTaskArtifacts
      .getState()
      .items.map((item) => (item.id === id ? { ...item, ...change } : item)),
  });
}

let listening: Promise<() => void> | undefined;
export async function trackTaskArtifacts(accountId: string) {
  if (useTaskArtifacts.getState().accountId !== accountId)
    useTaskArtifacts.setState({ items: [], accountId });
  listening ??= getCurrentWindow().listen<NativeDownload>(
    "misty://browser-download",
    ({ payload }) => {
      const execution = useLocalExecution.getState().execution;
      const previous = useTaskArtifacts
        .getState()
        .items.find((item) => item.id === payload.downloadId);
      if (!previous && (!execution || !execution.views.includes(payload.tabId))) return;
      if (previous && previous.state !== "downloading") return;
      const finished = payload.state === "finished" && payload.success;
      const artifact: TaskArtifact = {
        ...(previous ?? {
          id: payload.downloadId,
          taskId: execution!.taskId,
          agentId: execution!.agentId,
        }),
        name: payload.path.split(/[\\/]/).pop() || "Download",
        path: payload.path,
        state: finished ? "saving" : payload.state === "requested" ? "downloading" : "failed",
        downloaded: finished,
        error: finished ? undefined : payload.error,
      };
      put(artifact);
      if (!finished) return;
      const conversationId = execution?.conversationId;
      void saveAgentArtifact({
        agentId: artifact.agentId,
        path: artifact.path,
        kind: "download",
        conversationId,
      })
        .then(({ space }) => patch(artifact.id, { state: "saved", spaceName: space.name }))
        .catch(() =>
          patch(artifact.id, {
            state: "failed",
            error: "Downloaded to this computer, but it couldn’t be saved to the agent’s Space.",
          }),
        );
    },
  );
  await listening;
}
