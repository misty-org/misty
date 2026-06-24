import { publishNavigatorLayout, useNavigatorLayoutValue } from "@/features/app-shell";
import {
  appZoomDefault,
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
  FilePathControl,
  numberSetting,
  SliderControl,
  SelectControl,
  stringSetting,
  SwitchControl,
} from "../settingsControls";
import type { SettingsContentProps } from "../settingsTypes";

const wallpaperFilters = [{ name: "Video", extensions: ["mp4", "mov", "m4v"] }];

export function AppearanceSection(props: SettingsContentProps) {
  const wallpaperPath = stringSetting(props.document, "appearance", "wallpaper_path", "");
  const navigatorLayout = useNavigatorLayoutValue();
  const appZoom = useAppZoomValue();
  const [appZoomDraft, setAppZoomDraft] = useState<number | null>(null);
  const displayedAppZoom = appZoomDraft ?? appZoom;

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
          description="Scales the whole interface. Use Cmd/Ctrl +, Cmd/Ctrl −, or Cmd/Ctrl 0."
        >
          <div className="flex min-w-0 items-center gap-3">
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
            <button
              type="button"
              className={`rounded-sm text-xs text-cream-muted underline-offset-4 hover:text-cream hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cream-muted ${displayedAppZoom === appZoomDefault ? "invisible pointer-events-none" : ""}`}
              disabled={props.working || displayedAppZoom === appZoomDefault}
              aria-hidden={displayedAppZoom === appZoomDefault}
              onClick={() => {
                setAppZoom(appZoomDefault);
                setAppZoomDraft(null);
                props.onSettingChange("appearance", "app_zoom", appZoomRenderScale(appZoomDefault));
              }}
            >
              Reset
            </button>
          </div>
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
        <SettingsRow label="Active-pane indicator" last>
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
