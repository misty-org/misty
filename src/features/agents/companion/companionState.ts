import { create } from "zustand";
import type { Presentation } from "./protocol";
import type { GlobalSearchState } from "@/features/global-search/globalSearchState";
export interface CompanionSubmission {
  prompt: string;
  attachments?: Parameters<GlobalSearchState["submitAnswer"]>[1];
  conversationId: string;
  /** Capture the displays first: the task asked to look at the screen. */
  look?: boolean;
  /** Continues an earlier response; shows no new user turn. */
  continuation?: boolean;
  /** Explain and point at the attached screens, with no tools. */
  intent?: "teach";
  /** Read the answer aloud: it continues a spoken request. */
  voice?: boolean;
}
export type CompanionControl =
  | {
      kind: "size";
      size: number;
    }
  | {
      kind: "visibility";
      visible: boolean;
    }
  | {
      kind: "ask";
      ask: boolean;
    }
  | {
      kind: "model";
      model: string;
    }
  | {
      kind: "stop" | "stop_audio";
    }
  | {
      kind: "retry";
    };
export const initialCompanionPresentation: Presentation = {
  generation: 0,
  phase: "idle",
  visible: false,
  showCompanion: true,
  size: 100,
  enabled: false,
  mode: "auto", // Historical wire value; there is one interaction policy now.
  ask: false,
  model: "",
};
interface CompanionState {
  accountId: string;
  presentation: Presentation;
  control?: (control: CompanionControl) => Promise<void>;
  submit?: (request: CompanionSubmission) => Promise<void>;
}
/** Main-window bridge: the Agents page and native voice share one controller. */
export const useCompanionState = create<CompanionState>(() => ({
  accountId: "",
  presentation: initialCompanionPresentation,
}));
export async function companionControl(control: CompanionControl) {
  const handler = useCompanionState.getState().control;
  if (!handler) throw new Error("The companion is starting. Try again in a moment.");
  await handler(control);
}
