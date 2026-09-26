import sprite from "@/assets/branding/misty-icon.png?inline";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { Button, Switch } from "@/shared/ui";
import { useState } from "react";
import {
  companionSizeDefault,
  companionSizeMax,
  companionSizeMin,
  companionSizeStep,
  normalizeCompanionSize,
} from "./companionSize";
import { companionControl, useCompanionState, type CompanionControl } from "./companionState";
export function CompanionAppearanceSettings() {
  const { presentation, control } = useCompanionState();
  const [error, setError] = useState("");
  if (!hasTauriInternals() || !/Mac|Win/.test(navigator.platform)) return null;
  const size = normalizeCompanionSize(presentation.size);
  const change = (value: CompanionControl) => {
    setError("");
    void companionControl(value).catch((reason) => setError(String(reason)));
  };
  return (
    <section
      aria-label="Cursor companion"
      className="space-y-4 border-b border-charcoal-border pb-5"
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-medium text-cream">Cursor companion</h3>
          <p className="mt-1 text-xs text-cream-muted">
            Keep Misty beside your cursor, including outside the app.
          </p>
        </div>
        <Switch
          aria-label="Show cursor companion"
          checked={presentation.showCompanion ?? true}
          disabled={!control}
          onCheckedChange={(visible) =>
            change({
              kind: "visibility",
              visible,
            })
          }
        />
      </div>
      <div className="flex items-center gap-4">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center" aria-hidden="true">
          <img
            src={sprite}
            alt=""
            style={{
              width: (32 * size) / 100,
              height: (32 * size) / 100,
            }}
          />
        </div>
        <label className="min-w-0 flex-1 text-xs text-cream">
          <span className="mb-2 flex justify-between gap-3">
            <span>Companion size</span>
            <span>{size}%</span>
          </span>
          <input
            type="range"
            aria-label="Companion size"
            aria-valuetext={`${size}%`}
            min={companionSizeMin}
            max={companionSizeMax}
            step={companionSizeStep}
            value={size}
            disabled={!control}
            className="w-full accent-cream"
            onChange={(event) =>
              change({
                kind: "size",
                size: Number(event.target.value),
              })
            }
          />
        </label>
        <Button
          variant="ghost"
          size="sm"
          disabled={!control || size === companionSizeDefault}
          onClick={() =>
            change({
              kind: "size",
              size: companionSizeDefault,
            })
          }
        >
          Reset size
        </Button>
      </div>
      <p className="text-xs text-cream-muted">Applies immediately. Saved for you on this device.</p>
      {error && (
        <p role="alert" className="text-xs text-cream">
          {error}
        </p>
      )}
    </section>
  );
}
