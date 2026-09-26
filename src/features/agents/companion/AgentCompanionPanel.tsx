import sprite from "@/assets/branding/misty-icon.png?inline";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { Button } from "@/shared/ui";
import { MousePointer2, Square } from "lucide-react";
import { useState } from "react";
import "./agentCompanionPanel.css";
import { companionControl, useCompanionState, type CompanionControl } from "./companionState";
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
        <div className="agent-mode-selector" role="radiogroup" aria-label="Companion mode">
          {(["team", "auto"] as const).map((mode) => (
            <Button
              key={mode}
              variant="ghost"
              role="radio"
              className={`agent-mode-pill ${state.mode === mode ? "active" : ""}`}
              aria-checked={state.mode === mode}
              data-companion-mode={mode}
              tabIndex={state.mode === mode ? 0 : -1}
              onKeyDown={(event) => {
                if (
                  !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(
                    event.key,
                  )
                )
                  return;
                event.preventDefault();
                const next =
                  event.key === "Home"
                    ? "team"
                    : event.key === "End"
                      ? "auto"
                      : mode === "team"
                        ? "auto"
                        : "team";
                event.currentTarget.parentElement
                  ?.querySelector<HTMLButtonElement>(`[data-companion-mode="${next}"]`)
                  ?.focus();
                act({
                  kind: "mode",
                  mode: next,
                });
              }}
              disabled={!control}
              onClick={() =>
                act({
                  kind: "mode",
                  mode,
                })
              }
            >
              {mode === "team" ? "Team" : "Auto"}
            </Button>
          ))}
        </div>
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
          <select
            aria-label="Companion model"
            value={state.model}
            disabled={!control}
            onChange={(e) =>
              act({
                kind: "model",
                model: e.target.value,
              })
            }
          >
            <option value="">OpenAI · server default</option>
            {state.models?.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))}
          </select>
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
