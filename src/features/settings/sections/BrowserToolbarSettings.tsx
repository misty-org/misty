import {
  optionalToolbarButtons,
  parseHiddenToolbarButtons,
  toolbarHiddenKey,
} from "../browserToolbarButtons";
import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "../components/DesktopSettingsUI";
import { stringSetting, SwitchControl } from "../SettingsControls";
import type { SettingsContentProps } from "../settingsTypes";

/** Which buttons the browser toolbar shows. Back and the menu always stay. */
export function BrowserToolbarSettings(
  props: Pick<SettingsContentProps, "document" | "working" | "onSettingChange">,
) {
  const hidden = parseHiddenToolbarButtons(
    stringSetting(props.document, "general", toolbarHiddenKey, "[]"),
  );
  return (
    <SettingsSectionBlock
      title="Toolbar"
      description="Hidden buttons' commands stay in the browser menu and keyboard shortcuts."
    >
      {optionalToolbarButtons.map((button) => (
        <SettingsRow key={button.id} label={button.label}>
          <SwitchControl
            checked={!hidden.has(button.id)}
            disabled={props.working}
            onChange={(visible) => {
              const next = new Set(hidden);
              if (visible) next.delete(button.id);
              else next.add(button.id);
              props.onSettingChange(
                "general",
                toolbarHiddenKey,
                JSON.stringify(
                  optionalToolbarButtons.map((b) => b.id).filter((id) => next.has(id)),
                ),
              );
            }}
          />
        </SettingsRow>
      ))}
    </SettingsSectionBlock>
  );
}
