import {
  appZoomRenderScale,
  appZoomMax,
  appZoomMin,
  appZoomStep,
  setAppZoom,
  useAppZoomValue,
} from "@/shared/hooks/useAppZoom";
import { useState } from "react";
import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "../components/DesktopSettingsUI";
import {
  booleanSetting,
  ChoiceControl,
  numberSetting,
  SliderControl,
  SelectControl,
  stringSetting,
  SwitchControl,
} from "../SettingsControls";
import type { SettingsContentProps } from "../settingsTypes";
import { AccentColorControl } from "./AccentColorControl";
import { Input } from "@/shared/ui";
import { validThemeTime } from "../store/appTheme";

export function AppearanceSection(props: SettingsContentProps) {
  const appZoom = useAppZoomValue();
  const [appZoomDraft, setAppZoomDraft] = useState<number | null>(null);
  const displayedAppZoom = appZoomDraft ?? appZoom;

  return (
    <>
      <SettingsSectionBlock title="Theme">
        <SettingsRow
          label="Theme"
          description="System follows your computer's light or dark appearance. Scheduled switches at the times you choose."
        >
          <ChoiceControl
            value={stringSetting(props.document, "appearance", "theme_mode", "dark")}
            disabled={props.working}
            options={[
              { value: "system", label: "System" },
              { value: "dark", label: "Dark" },
              { value: "light", label: "Light" },
              { value: "scheduled", label: "Scheduled" },
            ]}
            onValueChange={(value) => props.onSettingChange("appearance", "theme_mode", value)}
          />
        </SettingsRow>
        {stringSetting(props.document, "appearance", "theme_mode", "dark") === "scheduled" ? (
          <>
            <SettingsRow label="Light from" indent>
              <ThemeTimeControl
                value={stringSetting(props.document, "appearance", "theme_light_start", "07:00")}
                disabled={props.working}
                onChange={(value) =>
                  props.onSettingChange("appearance", "theme_light_start", value)
                }
              />
            </SettingsRow>
            <SettingsRow label="Dark from" indent>
              <ThemeTimeControl
                value={stringSetting(props.document, "appearance", "theme_dark_start", "19:00")}
                disabled={props.working}
                onChange={(value) => props.onSettingChange("appearance", "theme_dark_start", value)}
              />
            </SettingsRow>
          </>
        ) : null}
        <SettingsRow
          label="Accent color"
          description="Marks the active tab, switches that are on and selected text. Everything else stays black and white."
        >
          <AccentColorControl
            value={stringSetting(props.document, "appearance", "accent_color", "")}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("appearance", "accent_color", value)}
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Layout">
        <SettingsRow
          label="App zoom"
          description="Scales the whole interface. Use Cmd/Ctrl +, Cmd/Ctrl −, or Cmd/Ctrl 0."
        >
          <SliderControl
            value={displayedAppZoom}
            min={appZoomMin}
            max={appZoomMax}
            step={appZoomStep}
            disabled={props.working}
            format={(value) => `${Math.round(value * 100)}%`}
            onChange={setAppZoomDraft}
            onCommit={(value) => {
              setAppZoom(value);
              setAppZoomDraft(null);
              props.onSettingChange("appearance", "app_zoom", appZoomRenderScale(value));
            }}
          />
        </SettingsRow>
        <SettingsRow
          label="Compact mode"
          description="Reduce padding and spacing in file-heavy views."
        >
          <SwitchControl
            checked={booleanSetting(props.document, "appearance", "compact_mode_enabled", false)}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("appearance", "compact_mode_enabled", value)}
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Pane focus">
        <SettingsRow
          label="Dim inactive panes"
          description="Keep the focused pane visually prominent."
        >
          <SwitchControl
            checked={booleanSetting(props.document, "appearance", "dim_inactive_panes", true)}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("appearance", "dim_inactive_panes", value)}
          />
        </SettingsRow>
        <SettingsRow label="Dimming strength">
          <SliderControl
            value={numberSetting(props.document, "appearance", "pane_dim_strength", 0.15)}
            min={0}
            max={0.4}
            step={0.01}
            disabled={
              props.working ||
              !booleanSetting(props.document, "appearance", "dim_inactive_panes", true)
            }
            format={(value) => `${Math.round(value * 100)}%`}
            onCommit={(value) => props.onSettingChange("appearance", "pane_dim_strength", value)}
          />
        </SettingsRow>
        <SettingsRow label="Active-pane indicator">
          <SelectControl
            value={Math.max(
              0,
              ["none", "outline", "border"].indexOf(
                stringSetting(props.document, "appearance", "pane_focus_indicator", "none"),
              ),
            )}
            options={["None", "Subtle outline", "Border"]}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange(
                "appearance",
                "pane_focus_indicator",
                ["none", "outline", "border"][value],
              )
            }
          />
        </SettingsRow>
      </SettingsSectionBlock>
    </>
  );
}

/** A local time for the scheduled theme; only complete times are saved. */
function ThemeTimeControl(props: {
  value: string;
  disabled: boolean;
  onChange(value: string): void;
}) {
  return (
    <Input
      type="time"
      className="w-32"
      value={props.value}
      disabled={props.disabled}
      onChange={(event) => {
        if (validThemeTime(event.target.value)) props.onChange(event.target.value);
      }}
    />
  );
}
