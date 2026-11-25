import { create } from "zustand";
import { notify } from "@misty/ui";
import type { AgentProfile } from "@/shared/schemas";
import { useCallStore } from "./call_store";
import type { LocalAgentCall } from "./local_agent_call";

interface AgentCallStore {
  call: LocalAgentCall | null;
  starting: boolean;
  transcript: boolean;
  toggleTranscript(): void;
  start(input: {
    agent: AgentProfile;
    conversationId: string;
    video: boolean;
    sees: boolean;
  }): void;
  end(): void;
}

export const useAgentCall = create<AgentCallStore>((set, get) => ({
  call: null,
  starting: false,
  transcript: false,
  toggleTranscript: () => set({ transcript: !get().transcript }),
  start: ({ agent, conversationId, video, sees }) => {
    if (get().call || get().starting || useCallStore.getState().active) {
      notify({ message: "Leave the call you’re in first." });
      return;
    }
    set({ starting: true, transcript: false });
    void import("./local_agent_call")
      .then(({ LocalAgentCall }) => {
        const call = new LocalAgentCall(agent, conversationId, sees, () => {
          if (get().call === call) set({ call: null });
        });
        set({ call, starting: false });
        void call.open(video);
      })
      .catch(() => {
        set({ starting: false });
        notify({ message: `The call with ${agent.name} couldn’t start.`, tone: "error" });
      });
  },
  end: () => get().call?.end(),
}));

useCallStore.subscribe((state, previous) => {
  if (state.active && !previous.active) useAgentCall.getState().end();
});

export function useAgentCallTranscript(conversationId?: string) {
  const inCall = useAgentCall((state) =>
    Boolean(conversationId && state.call?.conversationId === conversationId),
  );
  const shown = useAgentCall((state) => state.transcript);
  return { inCall, shown, toggle: useAgentCall.getState().toggleTranscript };
}

export const useAnyCall = () => {
  const agentCall = useAgentCall((state) => Boolean(state.call || state.starting));
  const call = useCallStore((state) => Boolean(state.active));
  return agentCall || call;
};
