import { hasTauriInternals } from "@/shared/platform/tauri";
import { Button, ErrorNotification, Slider } from "@/shared/ui";
import { useState } from "react";
import { DesktopSettingsRow, DesktopSettingsSection } from "@/features/settings";
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
    <DesktopSettingsSection title="Cursor">
      <DesktopSettingsRow label="Size">
        <div className="flex items-center gap-3">
          <Slider
            aria-label="Companion size"
            aria-valuetext={`${size}%`}
            className="w-[160px]"
            min={companionSizeMin}
            max={companionSizeMax}
            step={companionSizeStep}
            value={[size]}
            disabled={!control}
            onValueChange={([next]) => change({ kind: "size", size: next })}
          />
          <span className="w-10 text-right text-sm tabular-nums text-cream-muted">{size}%</span>
          <Button
            variant="ghost"
            size="sm"
            disabled={!control || size === companionSizeDefault}
            onClick={() => change({ kind: "size", size: companionSizeDefault })}
          >
            Reset size
          </Button>
        </div>
      </DesktopSettingsRow>
      <ErrorNotification message={error} onDismiss={() => setError("")} />
    </DesktopSettingsSection>
  );
}
