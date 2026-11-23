import { invoke } from "@tauri-apps/api/core";
import { effectiveValues, useDevicePreferences } from "@/features/settings/preference_access";
import { useMistyStore } from "../../conversations/state/use_misty_store";
import { useCollaborationStore } from "../../plans/store";
import { normalizeCompanionSize } from "./companion_size";
import { companionStage } from "./companion_stage";
import { focusCapture } from "./focus_capture";
import { withMistyControls } from "./misty_controls";
import type { DisplayCapture, Presentation, PresentedFocus } from "./protocol";

export function savedPresentation(): Presentation {
  const state = useDevicePreferences.getState().state;
  const values = state ? effectiveValues(state) : undefined;
  const ask = values?.["agents.companion.ask"] === true;
  const teach = values?.["agents.companion.teach"] === true;
  const size = normalizeCompanionSize(values?.["agents.companion.size"]);
  return {
    generation: 0,
    phase: "idle",
    visible: false,
    mode: "auto",
    ask,
    teach,
    size,
  };
}

export const captureScreens = (generation: number, signal: AbortSignal) =>
  companionStage(
    invoke<DisplayCapture[]>("cursor_companion_capture", { turn: generation }).then(
      withMistyControls,
    ),
    signal,
    "Screen capture",
    20_000,
  );

export async function withLessonCloseUp(
  screens: DisplayCapture[],
  generation: number,
  lastFocus: PresentedFocus | undefined,
) {
  const chat = useMistyStore.getState().activeConversationId;
  const lesson = useCollaborationStore.getState().modeFor(chat) === "teach";
  if (!lesson || !lastFocus || !screens.length) return screens;
  const close = await focusCapture(generation, lastFocus).catch(() => undefined);
  return close ? [...screens, close] : screens;
}
