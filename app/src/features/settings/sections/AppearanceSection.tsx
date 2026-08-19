import { publishNavigatorLayout, useNavigatorLayoutValue } from "@/features/app-shell";
import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "../components/DesktopSettingsUI";
import {
  booleanSetting,
  FilePathControl,
  numberSetting,
  SliderControl,
  stringSetting,
  SwitchControl,
} from "../settingsControls";
import type { SettingsContentProps } from "../settingsTypes";

const wallpaperFilters = [{ name: "Video", extensions: ["mp4", "mov", "m4v"] }];

export function AppearanceSection(props: SettingsContentProps) {
  const wallpaperPath = stringSetting(props.document, "appearance", "wallpaper_path", "");
  const navigatorLayout = useNavigatorLayoutValue();

  return (
    <>
      <SettingsSectionBlock title="Wallpaper">
        <SettingsRow
          label="Wallpaper video"
          description="Plays on a native layer behind Misty. Leave unset for a solid background."
        >
          <FilePathControl
            value={wallpaperPath}
            title="Choose wallpaper video"
            filters={wallpaperFilters}
            emptyLabel="None"
            disabled={props.working}
            onChange={(value) => props.onSettingChange("appearance", "wallpaper_path", value)}
          />
        </SettingsRow>
        <SettingsRow
          label="Panel opacity"
          description="How much of the wallpaper shows through Misty's surfaces."
          muted={!wallpaperPath}
          last
        >
          <SliderControl
            value={numberSetting(props.document, "appearance", "panel_opacity", 0.82)}
            min={0.4}
            max={1}
            step={0.02}
            disabled={props.working || !wallpaperPath}
            format={(value) => `${Math.round(value * 100)}%`}
            onCommit={(value) => props.onSettingChange("appearance", "panel_opacity", value)}
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Layout">
        <SettingsRow
          label="App zoom"
          description="Scales the whole interface. Also bound to Cmd +, Cmd -, and Cmd 0."
        >
          <SliderControl
            value={numberSetting(props.document, "appearance", "app_zoom", 1)}
            min={0.5}
            max={2}
            step={0.1}
            disabled={props.working}
            format={(value) => `${Math.round(value * 100)}%`}
            onCommit={(value) => props.onSettingChange("appearance", "app_zoom", value)}
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
        <SettingsRow
          label="Hide sidebar"
          description="Slide the rail away until you hover the edge of the window."
          last
        >
          <SwitchControl
            checked={navigatorLayout.visibility === "hidden"}
            disabled={props.working}
            onChange={(value) =>
              publishNavigatorLayout({
                width: "full",
                visibility: value ? "hidden" : "sticky",
              })
            }
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Media">
        <SettingsRow
          label="Thumbnail previews"
          description="Show preview-rich file rows where supported."
          last
        >
          <SwitchControl
            checked={booleanSetting(
              props.document,
              "appearance",
              "thumbnail_previews_enabled",
              true,
            )}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("appearance", "thumbnail_previews_enabled", value)
            }
          />
        </SettingsRow>
      </SettingsSectionBlock>
    </>
  );
}
