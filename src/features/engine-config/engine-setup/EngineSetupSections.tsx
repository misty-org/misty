// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong): CliConfigBody.tsx and
// CodeBuddyAuthSection.tsx.
// See NOTICE.

import { LogIn } from "lucide-react";
import { useState } from "react";
import { DesktopSettingsRow, DesktopSettingsSection as Section } from "@/features/settings";
import { Button } from "@misty/ui";
import type { EngineId } from "../channels/engines";
import { refreshCliStatus } from "../clis/use_cli_version_status";
import { SignInDialog } from "../clis/SignInDialog";
import { DshHostSection } from "./DshHostSection";
import { EngineProgramSection } from "./EngineProgramSection";
import { PiFamilyAuthSection } from "./PiFamilyAuthSection";

function CodeBuddySignIn() {
  const [open, setOpen] = useState(false);
  return (
    <Section title="Account">
      <DesktopSettingsRow label="CodeBuddy account">
        <Button variant="primary" onClick={() => setOpen(true)}>
          <LogIn />
          Sign in
        </Button>
      </DesktopSettingsRow>
      <SignInDialog
        request={open ? { engine: "codebuddy" } : null}
        onClose={() => {
          setOpen(false);
          void refreshCliStatus("codebuddy");
        }}
      />
    </Section>
  );
}

export function EngineSetupSections({ engine }: { engine: EngineId }) {
  return (
    <>
      <EngineProgramSection key={engine} engine={engine} />
      {engine === "pi" || engine === "omp" ? <PiFamilyAuthSection engine={engine} /> : null}
      {engine === "codebuddy" ? <CodeBuddySignIn /> : null}
      {engine === "dsh" ? <DshHostSection /> : null}
    </>
  );
}
