import { useMistyStore } from "../../conversations/state/useMistyStore";
import { DesktopSettingsRow, DesktopSettingsSection } from "@/features/settings";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { Button, IconButton, Kbd, Switch, Slider, useNotice } from "@/shared/ui";
import { RotateCcw, Square, VolumeX } from "lucide-react";
import { useState } from "react";
import "./agentCompanionPanel.css";
import { setCompanionOn, useCompanionOn } from "./companionOn";
import { companionControl, useCompanionState, type CompanionControl } from "./companionState";
import {
  companionSizeDefault,
  companionSizeMin,
  companionSizeMax,
  companionSizeStep,
  normalizeCompanionSize,
} from "./companionSize";

const teachLine =
  "Misty teaches one step at a time and checks your work when you ask, instead of doing it for " +
  "you. Each topic becomes its own lesson.";

export function AgentCompanionPanel() {
  const { presentation: state, control } = useCompanionState();
  const working = useMistyStore((s) => s.working);
  const [error, setError] = useState("");
  const on = useCompanionOn();
  const desktop = hasTauriInternals() && /Mac|Win/.test(navigator.platform);
  const size = normalizeCompanionSize(state.size);
  const act = (value: CompanionControl) => {
    setError("");
    void companionControl(value).catch((reason) => setError(String(reason)));
  };
  const shownError = error || state.error || "";
  useNotice(Boolean(shownError), {
    message: shownError,
    tone: "error",
    onDismiss: () => setError(""),
    action: desktop
      ? { label: "Retry companion", onSelect: () => act({ kind: "retry" }) }
      : undefined,
  });
  const active = working || state.phase !== "idle";
  const status =
    state.phase === "listening"
      ? "Listening"
      : state.phase === "responding"
        ? "Speaking"
        : "Working";
  return (
    <div className="agent-companion-panel" aria-label="Companion">
      {active && (
        <div className="agent-companion-status">
          <span role="status" className="misty-shimmer">
            {status}
          </span>
          {state.phase !== "idle" && (
            <Button icon={VolumeX} disabled={!control} onClick={() => act({ kind: "stop_audio" })}>
              Stop audio
            </Button>
          )}
          <Button icon={Square} disabled={!control} onClick={() => act({ kind: "stop" })}>
            Stop task
          </Button>
        </div>
      )}
      {!control && on !== false && (
        <p className="agent-companion-availability" role="status">
          {desktop ? "Starting" : "Available in Misty for macOS and Windows."}
        </p>
      )}
      <DesktopSettingsSection title="Behavior">
        {desktop && (
          <DesktopSettingsRow label="Tutor">
            <Switch
              aria-label="Tutor"
              checked={on === true}
              disabled={on === undefined}
              onCheckedChange={(next) =>
                void setCompanionOn(next).catch((reason: unknown) => setError(String(reason)))
              }
            />
          </DesktopSettingsRow>
        )}
        <DesktopSettingsRow label="Teach mode" description={teachLine}>
          <Switch
            aria-label="Teach mode"
            checked={state.teach === true}
            disabled={!control}
            onCheckedChange={(teach) => act({ kind: "teach", teach })}
          />
        </DesktopSettingsRow>
        <DesktopSettingsRow label="Ask before taking control">
          <Switch
            aria-label="Ask before taking control"
            checked={state.ask === true}
            disabled={!control}
            onCheckedChange={(ask) => act({ kind: "ask", ask })}
          />
        </DesktopSettingsRow>
        <div className="agent-companion-size">
          <div>
            <span>Companion size</span>
            <span>{size}%</span>
            <IconButton
              label="Reset size"
              disabled={!control || size === companionSizeDefault}
              onClick={() => act({ kind: "size", size: companionSizeDefault })}
            >
              <RotateCcw />
            </IconButton>
          </div>
          <Slider
            aria-label="Companion size"
            aria-valuetext={`${size}%`}
            min={companionSizeMin}
            max={companionSizeMax}
            step={companionSizeStep}
            value={[size]}
            disabled={!control}
            onValueChange={([next]) => act({ kind: "size", size: next })}
          />
        </div>
      </DesktopSettingsSection>
      <DesktopSettingsSection title="Voice">
        {desktop && (
          <DesktopSettingsRow label="Talk shortcut">
            <Kbd>{/Mac/.test(navigator.platform) ? "⌃ ⌥" : "Ctrl + Alt"}</Kbd>
          </DesktopSettingsRow>
        )}
      </DesktopSettingsSection>
    </div>
  );
}
