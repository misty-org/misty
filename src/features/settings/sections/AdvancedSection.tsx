import { MAX_PANE_DIM } from "@/features/workspace/paneFocus";
import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "../components/DesktopSettingsUI";
import {
  booleanSetting,
  ChoiceControl,
  numberSetting,
  SliderControl,
  SwitchControl,
} from "../SettingsControls";
import type { SettingsContentProps } from "../settingsTypes";

const sleepOptions = [
  { value: "60", label: "1 minute" },
  { value: "300", label: "5 minutes" },
  { value: "1800", label: "30 minutes" },
  { value: "0", label: "Never" },
];

/** Options few people change: page behaviors, window density and diagnostics. */
export function AdvancedSection(props: SettingsContentProps) {
  const toggle = (section: string, key: string, fallback: boolean) => ({
    checked: booleanSetting(props.document, section, key, fallback),
    disabled: props.working,
    onChange: (value: boolean) => props.onSettingChange(section, key, value),
  });
  const dim = booleanSetting(props.document, "appearance", "dim_inactive_panes", true);
  return (
    <>
      <SettingsSectionBlock title="Pages">
        <SettingsRow label="Link previews" description="Cards under links in chats and replies.">
          <SwitchControl {...toggle("general", "browser_link_previews", true)} />
        </SettingsRow>
        <SettingsRow label="Link and loading status" description="Shown in the page's corner.">
          <SwitchControl {...toggle("general", "browser_status_bubble", true)} />
        </SettingsRow>
        <SettingsRow
          label="Mouse gestures"
          description="Hold the right button and drag to go back, forward or reload."
        >
          <SwitchControl {...toggle("general", "browser_mouse_gestures", false)} />
        </SettingsRow>
        <SettingsRow label="Sleep hidden tabs" description="Tabs playing sound keep running.">
          <ChoiceControl
            value={String(
              numberSetting(props.document, "general", "browser_hidden_tab_sleep_seconds", 0),
            )}
            options={sleepOptions}
            disabled={props.working}
            onValueChange={(value) =>
              props.onSettingChange("general", "browser_hidden_tab_sleep_seconds", Number(value))
            }
          />
        </SettingsRow>
      </SettingsSectionBlock>
      <SettingsSectionBlock title="Display">
        <SettingsRow label="Dim inactive panes">
          <SwitchControl {...toggle("appearance", "dim_inactive_panes", true)} />
        </SettingsRow>
        {dim ? (
          <SettingsRow label="Dimming strength" indent>
            <SliderControl
              value={numberSetting(props.document, "appearance", "pane_dim_strength", 0.15)}
              min={0}
              max={MAX_PANE_DIM}
              step={0.01}
              disabled={props.working}
              format={(value) => `${Math.round(value * 100)}%`}
              onCommit={(value) => props.onSettingChange("appearance", "pane_dim_strength", value)}
            />
          </SettingsRow>
        ) : null}
        <SettingsRow label="Compact mode" description="Tighter spacing in file-heavy views.">
          <SwitchControl {...toggle("appearance", "compact_mode_enabled", false)} />
        </SettingsRow>
        <SettingsRow label="Frame pacing overlay" description="For diagnosing slow frames.">
          <SwitchControl {...toggle("advanced", "frame_pacing_overlay_enabled", false)} />
        </SettingsRow>
      </SettingsSectionBlock>
    </>
  );
}
