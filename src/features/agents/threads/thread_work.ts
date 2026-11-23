import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect } from "react";
import { create } from "zustand";
import { invoke } from "@/native/invoke";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { agentAccountId } from "../personal/agent_account";

export type ThreadState = "idle" | "working" | "landing" | "held" | "clashed";

export type ClashKind = "changed" | "deleted" | "created" | "folder";

export interface ThreadClash {
  path: string;
  kind: ClashKind;
}

export interface ThreadView {
  conversationId: string;
  spaceId: string;
  folder: string;
  state: ThreadState;
  clashes: ThreadClash[];
  note: string;
}

export interface ThreadOutput {
  path: string;
  local: string;
  spaceId: string;
  landedAt: number;
}

export type ClashChoice = "mine" | "theirs" | "agent";

const EVENT = "thread-work-changed";

interface ThreadWorkState {
  byConversation: Record<string, ThreadView | null>;
  outputs: Record<string, ThreadOutput[]>;
  load(conversationId: string): Promise<void>;
  loadOutputs(conversationId: string): Promise<void>;
  resolve(conversationId: string, choice: ClashChoice, path?: string): Promise<void>;
  land(conversationId: string): Promise<void>;
}

export const useThreadWork = create<ThreadWorkState>((set, get) => {
  const keep = (conversationId: string, view: ThreadView | null) =>
    set({ byConversation: { ...get().byConversation, [conversationId]: view } });
  return {
    byConversation: {},
    outputs: {},
    async load(conversationId) {
      const view = await invoke<ThreadView | null>("thread_work_status", {
        account: agentAccountId(),
        conversation: conversationId,
      });
      keep(conversationId, view);
    },
    async loadOutputs(conversationId) {
      const outputs = await invoke<ThreadOutput[]>("thread_outputs", {
        account: agentAccountId(),
        conversation: conversationId,
      });
      set({ outputs: { ...get().outputs, [conversationId]: outputs } });
    },
    async resolve(conversationId, choice, path) {
      const view = await invoke<ThreadView | null>("thread_work_resolve", {
        account: agentAccountId(),
        conversation: conversationId,
        path: path ?? null,
        choice,
      });
      keep(conversationId, view);
    },
    async land(conversationId) {
      const view = await invoke<ThreadView | null>("thread_work_land", {
        account: agentAccountId(),
        conversation: conversationId,
      });
      keep(conversationId, view);
    },
  };
});

let listening = false;

function listenOnce() {
  if (listening || !hasTauriInternals()) return;
  listening = true;
  let webview: ReturnType<typeof getCurrentWebview>;
  try {
    webview = getCurrentWebview();
  } catch {
    listening = false;
    return;
  }
  void webview
    .listen<ThreadView>(EVENT, ({ payload }) => {
      const store = useThreadWork.getState();
      useThreadWork.setState({
        byConversation: { ...store.byConversation, [payload.conversationId]: payload },
      });
      if (payload.state === "idle") {
        void store.loadOutputs(payload.conversationId).catch(() => undefined);
      }
    })
    .catch(() => {
      listening = false;
    });
}

export const watchThreadWork = listenOnce;

export function useThread(conversationId: string): ThreadView | null | undefined {
  useEffect(() => {
    listenOnce();
    if (!conversationId) return;
    void useThreadWork
      .getState()
      .load(conversationId)
      .catch(() => undefined);
  }, [conversationId]);
  return useThreadWork((state) => state.byConversation[conversationId]);
}

export function useThreadOutputs(conversationId: string): ThreadOutput[] | undefined {
  useEffect(() => {
    listenOnce();
    if (!conversationId) return;
    void useThreadWork
      .getState()
      .loadOutputs(conversationId)
      .catch(() => undefined);
  }, [conversationId]);
  return useThreadWork((state) => state.outputs[conversationId]);
}

export const folderName = (folder: string) => folder.split("/").filter(Boolean).pop() ?? folder;

export function clashPrompt(view: ThreadView): string {
  const lines = view.clashes.map((clash) => `- ${clash.path}`).join("\n");
  return (
    "While you worked, someone else changed these files in the Space, so your changes didn't " +
    `land:\n${lines}\n\nTheir versions are at the same paths in the Space's drive; yours are ` +
    "still in your copy. Merge each file in your copy so both sets of changes are kept, then " +
    "say what you merged."
  );
}

export interface ThreadClashes {
  conversationId: string;
  agentId: string;
  spaceId: string;
  folder: string;
  clashes: ThreadClash[];
}

export const threadClashes = () =>
  invoke<ThreadClashes[]>("thread_clashes", { account: agentAccountId() });
