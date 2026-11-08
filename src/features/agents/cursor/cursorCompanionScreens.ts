import { invoke } from "@tauri-apps/api/core";
import { useMistyStore } from "../conversations/state/useMistyStore";
import { useCollaborationStore } from "../plans/store";
import { companionSizeDefault, normalizeCompanionSize } from "./companionSize";
import { companionStage } from "./companionStage";
import { focusCapture } from "./focusCapture";
import { withMistyControls } from "./mistyControls";
import type { DisplayCapture, Presentation, PresentedFocus } from "./protocol";

/** The companion as this account last left it on this device; defaults when nothing is saved. */
export function savedPresentation(accountId: string): Presentation {
  let ask = false,
    teach = false,
    size = companionSizeDefault;
  try {
    const saved = JSON.parse(localStorage.getItem(`misty.cursor-companion:${accountId}`) || "{}");
    ask = saved.ask === true;
    teach = saved.teach === true;
    size = normalizeCompanionSize(saved.size);
  } catch {
    /* defaults */
  }
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

/** The screens, with Misty's own visible controls named on the one showing them. */
export const captureScreens = (generation: number, signal: AbortSignal) =>
  companionStage(
    invoke<DisplayCapture[]>("cursor_companion_capture", { turn: generation }).then(
      withMistyControls,
    ),
    signal,
    "Screen capture",
    20_000,
  );

/**
 * A Teach turn's screens plus a close-up of the region the last step pointed at, so a check
 * reads the person's work exactly. Without one, the screens alone.
 */
export async function withLessonCloseUp(
  screens: DisplayCapture[],
  generation: number,
  lastFocus: PresentedFocus | undefined,
) {
  const chat = useMistyStore.getState().activeConversationId;
  // The server takes a close-up only on a lesson step.
  const lesson = useCollaborationStore.getState().modeFor(chat) === "teach";
  if (!lesson || !lastFocus || !screens.length) return screens;
  const close = await focusCapture(generation, lastFocus).catch(() => undefined);
  return close ? [...screens, close] : screens;
}
