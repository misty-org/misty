import { DesktopSettingsRow as Row, DesktopSettingsSection as Section } from "@/features/settings";
import { SwitchControl } from "@/features/settings/SettingsControls";
import { useShowInLive } from "./liveVisibility";

/** Settings › Code › Collaboration: how the person shows up in a live session. Device-only. */
export function CollaborationSettings() {
  const shown = useShowInLive((state) => state.value);
  return (
    <Section title="Collaboration">
      <Row
        label="Show me in live sessions"
        description="Others see your cursor and face. A change applies from the next session you join."
      >
        <SwitchControl
          checked={shown}
          disabled={false}
          onChange={(value) => useShowInLive.getState().set(value)}
        />
      </Row>
    </Section>
  );
}
