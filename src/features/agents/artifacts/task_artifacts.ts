import { create } from "zustand";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useLocalExecution } from "../runs/local-execution/local_execution_state";
import { saveAgentArtifact } from "./agent_artifacts";

interface TaskArtifact {
  id: string;
  tabId: string;
  taskId: string;
  agentId: string;
  name: string;
  path: string;
  state: "downloading" | "saving" | "saved" | "failed";
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
          tabId: payload.tabId,
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
      void saveAgentArtifact({ agentId: artifact.agentId, path: artifact.path })
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
