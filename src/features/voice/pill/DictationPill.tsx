import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Lock, Mic, MicOff } from "lucide-react";
import { useEffect, useState } from "react";
import { IconButton, Spinner, Surface } from "@/shared/ui";
import type { PillState } from "../dictationEngine";

const initial: PillState = {
  phase: "listening",
  text: "",
  provisional: "",
  power: 0,
  locked: false,
};
const BARS = [0.5, 0.8, 1, 0.7, 0.9, 0.55];

/**
 * The dictation pill under the cursor (window misty-dictation-pill). It only
 * draws what the main window sends; Mute asks the main window to stop.
 */
export function DictationPill() {
  const [pill, setPill] = useState(initial);
  useEffect(() => {
    const remove = getCurrentWindow().listen<PillState>("misty://dictation-pill", ({ payload }) =>
      setPill(payload),
    );
    return () => void remove.then((fn) => fn());
  }, []);
  const listening = pill.phase === "listening";
  const level = Math.min(1, pill.power * 6);
  const words = pill.text || pill.provisional;
  return (
    // Dark in every theme, over whatever is under the cursor: the smoke panel and its white text.
    <Surface
      tone="smoke"
      radius="xl"
      raised
      role="status"
      aria-live="polite"
      className="m-1.5 box-border flex h-10 w-fit max-w-full items-center gap-2.5 pr-2 pl-3 text-meta leading-[1.2] font-medium"
    >
      {pill.phase === "finishing" ? (
        <Spinner size="sm" label="Finishing" />
      ) : (
        <span className="flex h-4 items-center gap-0.5" aria-hidden>
          {BARS.map((bar, index) => (
            <Surface
              as="i"
              key={index}
              tone="none"
              radius="sm"
              className="block w-1 bg-current transition-[height] duration-80 ease-linear"
              style={{ height: `${Math.max(2, Math.round(16 * bar * (listening ? level : 0)))}px` }}
            />
          ))}
        </span>
      )}
      <span className="min-w-0 flex-1 overflow-hidden whitespace-nowrap [mask-image:var(--mask-fade-end)]">
        {pill.note ? (
          <span className="opacity-55">{pill.note}</span>
        ) : words ? (
          <>
            {pill.text}
            {pill.provisional && <span className="opacity-55"> {pill.provisional}</span>}
          </>
        ) : (
          <span className="opacity-55">Listening</span>
        )}
      </span>
      {pill.locked && listening && (
        <Surface
          as="span"
          tone="smoke"
          radius="sm"
          className="inline-flex h-5 items-center px-2 text-micro whitespace-nowrap"
        >
          <span className="inline-flex items-center gap-1 opacity-70">
            <Lock aria-hidden /> Hands-free
          </span>
        </Surface>
      )}
      {listening && (
        // The pill keeps its light text in every theme, so the glyph does too in every state.
        <IconButton
          label="Mute and stop dictation"
          hint="Mute"
          className="text-inherit hover:text-inherit focus-visible:text-inherit"
          onClick={() => void emit("misty://dictation-pill-stop", {})}
        >
          {pill.power > 0 ? <Mic aria-hidden /> : <MicOff aria-hidden />}
        </IconButton>
      )}
    </Surface>
  );
}
