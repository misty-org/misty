import { Button, notify } from "@misty/ui";
import { invoke } from "@/native/invoke";
import { DesktopSettingsRow as Row, DesktopSettingsSection as Section } from "@/features/settings";

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
