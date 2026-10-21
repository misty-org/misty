import sprite from "@/shared/assets/misty-cloud-expression-cycle.webp?inline";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { Button, Slider, Switch } from "@/shared/ui";
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
    <DesktopSettingsSection
      title="Misty at your cursor"
      description="Misty stays beside your pointer, including outside the app. Changes apply at once and stay on this device."
    >
      <DesktopSettingsRow
        label="Show beside your cursor"
        description="Turn off to keep Misty out of the way until you call it."
      >
        <Switch
          aria-label="Show cursor companion"
          checked={presentation.showCompanion ?? true}
          disabled={!control}
          onCheckedChange={(visible) => change({ kind: "visibility", visible })}
        />
      </DesktopSettingsRow>
      <DesktopSettingsRow label="Size" description="How big Misty appears beside your cursor.">
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center" aria-hidden="true">
            <img
              src={sprite}
              alt=""
              style={{ width: (32 * size) / 100, height: (32 * size) / 100 }}
            />
          </div>
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
          <span className="w-10 text-right text-[14px] tabular-nums text-cream-muted">{size}%</span>
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
      {error && (
        <p role="alert" className="border-t border-charcoal-border py-3 text-[14px] text-cream">
          {error}
        </p>
      )}
    </DesktopSettingsSection>
  );
}
