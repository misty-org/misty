import { DesktopSettingsRow as Row, DesktopSettingsSection as Section } from "@/features/settings";
import { DropdownControl, SwitchControl } from "@/features/settings/SettingsControls";
import { cursorTones, useCursorTone, useShowInLive } from "./liveVisibility";

const toneChoices = [
  { value: "auto", label: "Automatic" },
  ...cursorTones.map((tone) => ({ value: tone, label: tone[0]!.toUpperCase() + tone.slice(1) })),
];

/** Settings › Code › Collaboration: how the person shows up in a live session. Device-only. */
export function CollaborationSettings() {
  const shown = useShowInLive((state) => state.value);
  const tone = useCursorTone((state) => state.value);
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
      <Row label="Cursor color" muted={!shown}>
        <DropdownControl
          value={tone}
          options={toneChoices}
          disabled={!shown}
          onValueChange={(value) => useCursorTone.getState().set(value as typeof tone)}
        />
      </Row>
    </Section>
  );
}
