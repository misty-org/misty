import { useMistyStore } from "../../conversations/state/useMistyStore";
import { DesktopSettingsRow, DesktopSettingsSection } from "@/features/settings";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { Button, ErrorNotification, IconButton, Switch, Slider } from "@/shared/ui";
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
            <Button
              variant="outline"
              size="sm"
              disabled={!control}
              onClick={() => act({ kind: "stop_audio" })}
            >
              <VolumeX size={16} />
              Stop audio
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={!control}
            onClick={() => act({ kind: "stop" })}
          >
            <Square size={16} />
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
          <DesktopSettingsRow label="Cursor tutor">
            <Switch
              aria-label="Cursor tutor"
              checked={on === true}
              disabled={on === undefined}
              onCheckedChange={(next) =>
                void setCompanionOn(next).catch((reason: unknown) => setError(String(reason)))
              }
            />
          </DesktopSettingsRow>
        )}
        <DesktopSettingsRow
          label="Teach mode"
          description="Misty teaches one step at a time and checks your work when you ask, instead of doing it for you. Each topic becomes its own lesson."
        >
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
              <RotateCcw size={16} />
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
            <kbd>{/Mac/.test(navigator.platform) ? "⌃ ⌥" : "Ctrl + Alt"}</kbd>
          </DesktopSettingsRow>
        )}
      </DesktopSettingsSection>
      <ErrorNotification message={error || state.error} onDismiss={() => setError("")}>
        {desktop && (
          <Button type="button" variant="ghost" size="sm" onClick={() => act({ kind: "retry" })}>
            Retry companion
          </Button>
        )}
      </ErrorNotification>
    </div>
  );
}
