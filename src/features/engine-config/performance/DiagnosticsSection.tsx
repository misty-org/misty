import { Button, notify } from "@misty/ui";
import { invoke } from "@/native/invoke";
import { DesktopSettingsRow as Row, DesktopSettingsSection as Section } from "@/features/settings";

/**
 * Settings › Advanced › Diagnostics: where Misty keeps its crash log, which holds a panic's
 * thread and backtrace and never leaves this computer.
 */
export function DiagnosticsSection() {
  return (
    <Section title="Diagnostics">
      <Row label="Crash log">
        <Button
          variant="secondary"
          onClick={() =>
            void invoke("app_reveal_crash_log").catch(() =>
              notify({ message: "The crash log couldn't be shown. Try again.", tone: "error" }),
            )
          }
        >
          Show in folder
        </Button>
      </Row>
    </Section>
  );
}
