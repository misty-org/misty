import { MAX_PANE_DIM } from "../panes/paneFocus";
import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "@/features/settings";
import {
  booleanSetting,
  numberSetting,
  SliderControl,
  SwitchControl,
} from "../../settings/SettingsControls";
import type { SettingsContentProps } from "../../settings/settingsTypes";

/** Options few people change: link previews, window density and diagnostics. */
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
