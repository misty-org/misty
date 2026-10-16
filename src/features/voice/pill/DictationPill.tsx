import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Lock, Mic, MicOff } from "lucide-react";
import { useEffect, useState } from "react";
import { IconButton } from "@/shared/ui";
import type { PillState } from "../dictationEngine";
import "./dictationPill.css";

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
    <div className="dictation-pill" role="status" aria-live="polite">
      {pill.phase === "finishing" ? (
        <span className="dictation-pill-spinner" aria-label="Finishing" />
      ) : (
        <span className="dictation-pill-meter" aria-hidden>
          {BARS.map((bar, index) => (
            <i
              key={index}
              style={{ height: `${Math.max(2, Math.round(16 * bar * (listening ? level : 0)))}px` }}
            />
          ))}
        </span>
      )}
      <span className="dictation-pill-text">
        {pill.note ? (
          <span className="dictation-pill-note">{pill.note}</span>
        ) : words ? (
          <>
            {pill.text}
            {pill.provisional && (
              <span className="dictation-pill-provisional"> {pill.provisional}</span>
            )}
          </>
        ) : (
          <span className="dictation-pill-note">Listening</span>
        )}
      </span>
      {pill.locked && listening && (
        <span className="dictation-pill-chip">
          <Lock size={11} aria-hidden /> Hands-free
        </span>
      )}
      {listening && (
        <IconButton
          label="Mute and stop dictation"
          tooltip="Mute"
          shape="round"
          size="xs"
          className="dictation-pill-button"
          onClick={() => void emitTo("main", "misty://dictation-pill-stop", {})}
        >
          {pill.power > 0 ? <Mic size={14} aria-hidden /> : <MicOff size={14} aria-hidden />}
        </IconButton>
      )}
    </div>
  );
}
