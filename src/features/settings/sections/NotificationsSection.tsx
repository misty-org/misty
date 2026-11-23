import {
  DesktopSettingsRow as Row,
  DesktopSettingsSection as SettingsSectionBlock,
} from "../components/DesktopSettingsUI";
import { useMessageNotices } from "@/shared/lib/message_notices";
import { ChoiceControl, SwitchControl } from "../SettingsControls";
import { PreferenceRow } from "./PreferenceRow";

const spaceChoices = [
  { value: "mentions", label: "Mentions" },
  { value: "all", label: "All" },
  { value: "off", label: "Off" },
];

export function NotificationsSection() {
  const prefs = useMessageNotices((state) => state.value);
  const change = (next: Partial<typeof prefs>) =>
    useMessageNotices.getState().set((current) => ({ ...current, ...next }));
  return (
    <SettingsSectionBlock title="Notifications">
      <Row label="Direct messages">
        <SwitchControl
          checked={prefs.direct}
          disabled={false}
          onChange={(direct) => change({ direct })}
        />
      </Row>
      <Row label="Space messages">
        <ChoiceControl
          value={prefs.spaces}
          options={spaceChoices}
          disabled={false}
          onValueChange={(spaces) => change({ spaces: spaces as typeof prefs.spaces })}
        />
      </Row>
      <PreferenceRow id="agents.run_notifications" />
    </SettingsSectionBlock>
  );
}
