import { useState } from "react";
import { notify } from "@misty/ui";
import { DesktopSettingsRow as Row, DesktopSettingsSection as Section } from "@/features/settings";
import { DropdownControl } from "@/features/settings/SettingsControls";
import { TextControl } from "@/features/settings/SettingsTextControls";
import type { ChosenStatus } from "../api";
import { useStatusStore } from "../statusStore";

const clearAfterChoices = [
  { value: "never", label: "Don't clear" },
  { value: "1h", label: "In 1 hour" },
  { value: "4h", label: "In 4 hours" },
  { value: "today", label: "Today" },
];

/** When a custom status runs out, counted from now; null keeps it until the person clears it. */
function expiry(after: string): string | null {
  const now = new Date();
  if (after === "1h") return new Date(now.getTime() + 3_600_000).toISOString();
  if (after === "4h") return new Date(now.getTime() + 4 * 3_600_000).toISOString();
  if (after === "today") {
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    return end.toISOString();
  }
  return null;
}

const shows = [
  { value: "online", label: "Online" },
  { value: "dnd", label: "Do not disturb" },
  { value: "invisible", label: "Invisible" },
];

/**
 * Settings › Profile › Status: how the person shows to others, from the account's status store
 * (the profile menu changes the same one). Online turns Idle by itself after ten minutes without
 * input; Do not disturb also silences notices on this computer. Saved on the account as chosen.
 */
export function StatusSection() {
  const mine = useStatusStore((state) => state.mine);
  const [clearAfter, setClearAfter] = useState("never");
  const save = (next: ChosenStatus) =>
    useStatusStore
      .getState()
      .setMine(next)
      .catch(() => notify({ message: "Your status couldn't be changed. Try again.", tone: "error" }));
  return (
    <Section title="Status">
      <Row label="Show as">
        <DropdownControl
          value={mine.chosen}
          options={shows}
          disabled={false}
          onValueChange={(chosen) => void save({ ...mine, chosen: chosen as ChosenStatus["chosen"] })}
        />
      </Row>
      <Row label="Custom status">
        <TextControl
          value={mine.custom_text ?? ""}
          placeholder="What are you up to?"
          disabled={false}
          onCommit={(text) =>
            void save({ ...mine, custom_text: text.trim(), custom_expires_at: expiry(clearAfter) })
          }
        />
      </Row>
      <Row label="Clear after" muted={!mine.custom_text}>
        <DropdownControl
          value={clearAfter}
          options={clearAfterChoices}
          disabled={!mine.custom_text}
          onValueChange={(after) => {
            setClearAfter(after);
            void save({ ...mine, custom_expires_at: expiry(after) });
          }}
        />
      </Row>
    </Section>
  );
}
