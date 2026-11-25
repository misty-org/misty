import { MAX_PANE_DIM } from "../panes/pane_focus";
import { DesktopSettingsRow as SettingsRow } from "@/features/settings";
import {
  booleanSetting,
  numberSetting,
  SliderControl,
  SwitchControl,
} from "../../settings/SettingsControls";
import type { SettingsContentProps } from "../../settings/settings_types";

function toggle(props: SettingsContentProps, section: string, key: string, fallback: boolean) {
  return {
    checked: booleanSetting(props.document, section, key, fallback),
    disabled: props.working,
    onChange: (value: boolean) => props.onSettingChange(section, key, value),
  };
}

export function PaneDisplayRows(props: SettingsContentProps) {
  const dim = booleanSetting(props.document, "appearance", "dim_inactive_panes", true);
  return (
    <>
      <SettingsRow label="Compact mode" description="Tighter spacing in file-heavy views.">
        <SwitchControl {...toggle(props, "appearance", "compact_mode_enabled", false)} />
      </SettingsRow>
      <SettingsRow label="Dim inactive panes">
        <SwitchControl {...toggle(props, "appearance", "dim_inactive_panes", true)} />
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
    </>
  );
}

export function LinkPreviewsRow(props: SettingsContentProps) {
  return (
    <SettingsRow label="Link previews" description="Cards under links in chats and replies.">
      <SwitchControl {...toggle(props, "general", "browser_link_previews", true)} />
    </SettingsRow>
  );
}

export function FramePacingRow(props: SettingsContentProps) {
  return (
    <SettingsRow label="Frame pacing overlay" description="For diagnosing slow frames.">
      <SwitchControl {...toggle(props, "advanced", "frame_pacing_overlay_enabled", false)} />
    </SettingsRow>
  );
}
