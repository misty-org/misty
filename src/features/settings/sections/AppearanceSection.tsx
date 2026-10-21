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
  stringSetting,
  SwitchControl,
} from "../SettingsControls";
import type { SettingsContentProps } from "../settingsTypes";
import { Input } from "@/shared/ui";
import { validClockTime } from "../store/nightLight";
import { MAX_PANE_DIM } from "@/features/workspace/paneFocus";
import { normalizeDockingLayout } from "@/features/app-shell/dockingLayout";
import { useWindowDockingLayout, useWorkspaceStore } from "@/features/workspace";

export function AppearanceSection(props: SettingsContentProps) {
  const appZoom = useAppZoomValue();
  const [appZoomDraft, setAppZoomDraft] = useState<number | null>(null);
  const displayedAppZoom = appZoomDraft ?? appZoom;
  const nightLight = stringSetting(props.document, "appearance", "night_light_mode", "off");

  return (
    <>
      <SettingsSectionBlock title="Theme">
        <SettingsRow
          label="Theme"
          description="System follows your computer's light or dark appearance."
        >
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
        <SettingsRow
          label="Night light"
          description="Warms the whole window and every page to ease your eyes in the evening."
        >
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
        <SettingsRow
          label="Space bar alignment"
          description="Where the Space, its pages and People sit along the Space bar."
        >
          <ChoiceControl
            value={stringSetting(props.document, "appearance", "space_bar_alignment", "left")}
            disabled={props.working}
            options={[
              { value: "left", label: "Left" },
              { value: "center", label: "Center" },
              { value: "right", label: "Right" },
            ]}
            onValueChange={(value) =>
              props.onSettingChange("appearance", "space_bar_alignment", value)
            }
          />
        </SettingsRow>
        <SettingsRow
          label="Auto-hide the Space bar"
          description="Tuck the Space bar away until you move the pointer to the top edge of the page. It makes room for itself when it returns."
        >
          <SwitchControl
            checked={booleanSetting(props.document, "appearance", "space_bar_auto_hide", false)}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("appearance", "space_bar_auto_hide", value)}
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Size">
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
            max={MAX_PANE_DIM}
            step={0.01}
            disabled={
              props.working ||
              !booleanSetting(props.document, "appearance", "dim_inactive_panes", true)
            }
            format={(value) => `${Math.round(value * 100)}%`}
            onCommit={(value) => props.onSettingChange("appearance", "pane_dim_strength", value)}
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

/** Which side of this window the tab sidebar sits on. Each Space's window keeps its own. */
function WindowTabsRow() {
  const layout = useWindowDockingLayout();
  const setLayout = useWorkspaceStore((state) => state.setWindowDockingLayout);
  return (
    <SettingsRow
      label="Tabs"
      description="Which side of this window the tab sidebar sits on. Each Space's window keeps its own."
    >
      <ChoiceControl
        value={layout.tabs}
        disabled={false}
        options={[
          { value: "left", label: "Left" },
          { value: "right", label: "Right" },
        ]}
        onValueChange={(value) =>
          setLayout(normalizeDockingLayout({ navigation: layout.navigation, tabs: value }))
        }
      />
    </SettingsRow>
  );
}
