import { create } from "zustand";
import type { Presentation } from "./protocol";
import type { MistyState } from "../../conversations/state/misty_state";
export interface CompanionSubmission {
  prompt: string;
  attachments?: Parameters<MistyState["submitAnswer"]>[1];
  conversationId: string;
  look?: boolean;
  continuation?: boolean;
  voice?: boolean;
}
export type CompanionControl =
  | {
      kind: "size";
      size: number;
    }
  | {
      kind: "ask";
      ask: boolean;
    }
  | {
      kind: "teach";
      teach: boolean;
    }
  | {
      kind: "stop" | "stop_audio";
    }
  | {
      kind: "retry";
    }
  | {
      kind: "captions";
      captions: boolean;
    }
  | {
      kind: "tint";
      tint: string;
    }
  | {
      kind: "sprite";
      sprite: boolean;
    }
  | {
      kind: "tour";
      start: boolean;
    };
export const initialCompanionPresentation: Presentation = {
  generation: 0,
  phase: "idle",
  visible: false,
  size: 100,
  enabled: false,
  mode: "auto",
  ask: false,
};
interface CompanionState {
  accountId: string;
  presentation: Presentation;
  control?: (control: CompanionControl) => Promise<void>;
  submit?: (request: CompanionSubmission) => Promise<void>;
}
export const useCompanionState = create<CompanionState>(() => ({
  accountId: "",
  presentation: initialCompanionPresentation,
}));
export async function companionControl(control: CompanionControl) {
  const handler = useCompanionState.getState().control;
  if (!handler) throw new Error("The companion is starting. Try again in a moment.");
  await handler(control);
}
