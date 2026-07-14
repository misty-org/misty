import { useMistyStore } from "@/features/misty/useMistyStore";
import sprite from "@/shared/assets/misty-cloud-expression-cycle.webp?inline";
import { hasTauriInternals } from "@/shared/platform/tauri";
import {
  Button,
  SegmentedControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui";
import { MousePointer2, Square } from "lucide-react";
import { useState } from "react";
import "./agentCompanionPanel.css";
import { companionControl, useCompanionState, type CompanionControl } from "./companionState";

// Radix Select has no empty value, so the server default gets a stand-in.
const serverDefaultModel = "__server_default__";

export function AgentCompanionPanel() {
  const { presentation: state, control } = useCompanionState();
  const working = useMistyStore((s) => s.working);
  const [error, setError] = useState("");
  const desktop = hasTauriInternals() && /Mac|Win/.test(navigator.platform);
  const act = (value: CompanionControl) => {
    setError("");
    void companionControl(value).catch((reason) => setError(String(reason)));
  };
  const status =
    error || state.error
      ? "Needs attention"
      : !state.enabled
        ? "Starting…"
        : state.phase === "listening"
          ? "Listening…"
          : state.phase === "processing" || working
            ? "Working…"
            : state.phase === "responding"
              ? "Speaking…"
              : "Ready";
  return (
    <div className="agent-companion-panel" aria-label="Companion">
      <div className="agent-companion-topline">
        <img src={sprite} width={32} height={32} alt="" />
        <div className="agent-companion-title">
          <h2>Companion</h2>
          <span role="status">
            {control
              ? status
              : desktop
                ? "Starting…"
                : "Desktop voice available in Misty for macOS and Windows"}
          </span>
        </div>
        {desktop && (
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={state.showCompanion ?? true}
            disabled={!control}
            onClick={() =>
              act({
                kind: "visibility",
                visible: !state.showCompanion,
              })
            }
          >
            <MousePointer2 size={14} />
            {state.showCompanion ? "Cursor on" : "Cursor off"}
          </Button>
        )}
        {(working || state.phase !== "idle") && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              act({
                kind: "stop",
              })
            }
          >
            <Square size={13} />
            Stop
          </Button>
        )}
      </div>
      <div className="agent-companion-mode-row">
        <SegmentedControl
          label="Companion mode"
          value={state.mode}
          disabled={!control}
          options={[
            { value: "team", label: "Team", attributes: { "data-companion-mode": "team" } },
            { value: "auto", label: "Auto", attributes: { "data-companion-mode": "auto" } },
          ]}
          onChange={(mode) => act({ kind: "mode", mode })}
        />
        <p>
          {state.mode === "team"
            ? "Ask questions or hand off a step. You stay in control."
            : "Hand off a task. Misty works through the steps in your tabs."}
        </p>
      </div>
      <details className="agent-companion-options">
        <summary>Voice & model</summary>
        {desktop && (
          <p>
            Hold <kbd>{/Mac/.test(navigator.platform) ? "Control + Option" : "Control + Alt"}</kbd>{" "}
            to talk. Release to send. Hold again to interrupt.
          </p>
        )}
        <label>
          Model
          <Select
            value={state.model || serverDefaultModel}
            disabled={!control}
            onValueChange={(model) =>
              act({ kind: "model", model: model === serverDefaultModel ? "" : model })
            }
          >
            <SelectTrigger aria-label="Companion model" className="h-8 min-w-0 max-w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={serverDefaultModel}>OpenAI · server default</SelectItem>
              {state.models?.map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  {model.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </details>
      {(error || state.error) && (
        <div className="agent-companion-error" role="alert">
          <p>{error || state.error}</p>
          {desktop && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                act({
                  kind: "retry",
                })
              }
            >
              Retry companion
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
