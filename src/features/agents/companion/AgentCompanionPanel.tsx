import { useMistyStore } from "@/features/misty/useMistyStore";
import { DesktopSettingsRow, DesktopSettingsSection } from "@/features/settings";
import sprite from "@/shared/assets/misty-cloud-expression-cycle.webp?inline";
import { hasTauriInternals } from "@/shared/platform/tauri";
import {
  Button,
  IconButton,
  Switch,
  Slider,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui";
import { RotateCcw, Square } from "lucide-react";
import { useState } from "react";
import "./agentCompanionPanel.css";
import { companionControl, useCompanionState, type CompanionControl } from "./companionState";
import {
  companionSizeDefault,
  companionSizeMin,
  companionSizeMax,
  companionSizeStep,
  normalizeCompanionSize,
} from "./companionSize";

// Radix Select has no empty value, so the server default gets a stand-in.
const serverDefaultModel = "__server_default__";

export function AgentCompanionPanel() {
  const { presentation: state, control } = useCompanionState();
  const working = useMistyStore((s) => s.working);
  const [error, setError] = useState("");
  const desktop = hasTauriInternals() && /Mac|Win/.test(navigator.platform);
  const size = normalizeCompanionSize(state.size);
  const act = (value: CompanionControl) => {
    setError("");
    void companionControl(value).catch((reason) => setError(String(reason)));
  };
  const active = working || state.phase !== "idle";
  const status =
    state.phase === "listening"
      ? "Listening…"
      : state.phase === "responding"
        ? "Speaking…"
        : "Working…";
  return (
    <div className="agent-companion-panel" aria-label="Companion">
      <div className="agent-companion-preview">
        <img src={sprite} width={80} height={80} alt="" />
      </div>
      {active && (
        <div className="agent-companion-status">
          <span role="status">{status}</span>
          <Button
            variant="ghost"
            size="sm"
            disabled={!control}
            onClick={() => act({ kind: "stop" })}
          >
            <Square size={16} />
            Stop
          </Button>
        </div>
      )}
      {!control && (
        <p className="agent-companion-availability" role="status">
          {desktop ? "Starting…" : "Available in Misty for macOS and Windows."}
        </p>
      )}
      <DesktopSettingsSection title="Behavior">
        <DesktopSettingsRow label="Show companion">
          <Switch
            aria-label="Show companion"
            checked={state.showCompanion ?? true}
            disabled={!control}
            onCheckedChange={(visible) => act({ kind: "visibility", visible })}
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
        <DesktopSettingsRow label="Model" last>
          <Select
            value={state.model || serverDefaultModel}
            disabled={!control}
            onValueChange={(model) =>
              act({ kind: "model", model: model === serverDefaultModel ? "" : model })
            }
          >
            <SelectTrigger aria-label="Companion model">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={serverDefaultModel}>Server default</SelectItem>
              {state.models?.map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  {model.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </DesktopSettingsRow>
      </DesktopSettingsSection>
      {(error || state.error) && (
        <div className="agent-companion-error" role="alert">
          <p>{error || state.error}</p>
          {desktop && (
            <Button variant="ghost" size="sm" onClick={() => act({ kind: "retry" })}>
              Retry companion
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
