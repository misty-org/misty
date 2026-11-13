import { getCurrentWindow } from "@tauri-apps/api/window";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { recordingPower } from "./motion";
import { cursorEvent, type CursorSample, type Presentation } from "./protocol";

// Mutable input state shared between the event listeners and the animation loop.
export type CursorInputs = {
  sample: CursorSample | undefined;
  power: number;
  meterTurn: number;
};

export function listenToCursorInputs(
  latest: { current: Presentation },
  inputs: CursorInputs,
): Promise<UnlistenFn>[] {
  return [
    getCurrentWindow().listen<CursorSample>(cursorEvent, ({ payload }) => {
      inputs.sample = payload;
    }),
    getCurrentWindow().listen<{
      turn: number;
      power: number;
    }>("misty://cursor-meter", ({ payload }) => {
      if (payload.turn === latest.current.generation) {
        if (inputs.meterTurn !== payload.turn) inputs.power = 0;
        inputs.meterTurn = payload.turn;
        inputs.power = recordingPower(payload.power, inputs.power);
      }
    }),
  ];
}
