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
} from "@/features/settings";
import {
  ChoiceControl,
  numberSetting,
  SliderControl,
  stringSetting,
} from "../../settings/SettingsControls";
import type { SettingsContentProps } from "../../settings/settingsTypes";
import { Input } from "@/shared/ui";
import { validClockTime } from "@/features/settings";
import { normalizeDockingLayout, rememberDockingLayout } from "@/app/shell/dockingLayout";
import { useWindowDockingLayout } from "../panes/useWindowDockingLayout";
import { useWorkspaceStore } from "../tabs/useWorkspaceStore";

export function AppearanceSection(props: SettingsContentProps) {
  const appZoom = useAppZoomValue();
  const [appZoomDraft, setAppZoomDraft] = useState<number | null>(null);
  const displayedAppZoom = appZoomDraft ?? appZoom;
  const nightLight = stringSetting(props.document, "appearance", "night_light_mode", "off");

  return (
    <>
      <SettingsSectionBlock title="Theme">
        <SettingsRow label="Theme" description="System follows your computer.">
          <ChoiceControl
            value={stringSetting(props.document, "appearance", "theme_mode", "dark")}
            disabled={props.working}
            options={[
              { value: "system", label: "System" },
              { value: "dark", label: "Dark" },
              { value: "light", label: "Light" },
            ]}
            onValueChange={(value) => props.onSettingChange("appearance", "theme_mode", value)}
          />
        </SettingsRow>
        <SettingsRow label="Night light" description="Warms the window and every page.">
          <ChoiceControl
            value={nightLight}
            disabled={props.working}
            options={[
              { value: "off", label: "Off" },
              { value: "on", label: "On" },
              { value: "scheduled", label: "Scheduled" },
            ]}
            onValueChange={(value) =>
              props.onSettingChange("appearance", "night_light_mode", value)
            }
          />
        </SettingsRow>
        {nightLight === "scheduled" ? (
          <>
            <SettingsRow label="Turns on" indent>
              <ClockTimeControl
                value={stringSetting(props.document, "appearance", "night_light_start", "21:00")}
                disabled={props.working}
                onChange={(value) =>
                  props.onSettingChange("appearance", "night_light_start", value)
                }
              />
            </SettingsRow>
            <SettingsRow label="Turns off" indent>
              <ClockTimeControl
                value={stringSetting(props.document, "appearance", "night_light_end", "07:00")}
                disabled={props.working}
                onChange={(value) => props.onSettingChange("appearance", "night_light_end", value)}
              />
            </SettingsRow>
          </>
        ) : null}
        {nightLight !== "off" ? (
          <SettingsRow label="Warmth" indent>
            <SliderControl
              value={numberSetting(props.document, "appearance", "night_light_warmth", 0.5)}
              min={0.1}
              max={1}
              step={0.05}
              disabled={props.working}
              format={(value) => `${Math.round(value * 100)}%`}
              onCommit={(value) => props.onSettingChange("appearance", "night_light_warmth", value)}
            />
          </SettingsRow>
        ) : null}
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Window">
        <WindowTabsRow />
        <SettingsRow label="App zoom" description="Also Cmd or Ctrl with +, − and 0.">
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
      </SettingsSectionBlock>
    </>
  );
}

/** A local time for the night light schedule; only complete times are saved. */
function ClockTimeControl(props: {
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
        if (validClockTime(event.target.value)) props.onChange(event.target.value);
      }}
    />
  );
}

/** Which side of this window the tab sidebar sits on. Each window keeps its own. */
function WindowTabsRow() {
  const layout = useWindowDockingLayout();
  const setLayout = useWorkspaceStore((state) => state.setWindowDockingLayout);
  return (
    <SettingsRow label="Tabs" description="For this window.">
      <ChoiceControl
        value={layout.tabs}
        disabled={false}
        options={[
          { value: "left", label: "Left" },
          { value: "right", label: "Right" },
        ]}
        onValueChange={(value) => {
          const next = normalizeDockingLayout({ navigation: layout.navigation, tabs: value });
          setLayout(next);
          // New windows open with the side last picked.
          rememberDockingLayout(next);
        }}
      />
    </SettingsRow>
  );
}
