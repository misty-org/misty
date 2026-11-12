// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong): CliConfigBody.tsx and
// CodeBuddyAuthSection.tsx.
// See NOTICE.

/**
 * What an engine's page in Settings › Channels holds besides its channels: its program (path,
 * Codex's home, custom models) and how it signs in. Pi and Oh My Pi list their providers,
 * CodeBuddy opens its own `/login`, DeepSeek Harness shows its local host.
 */
import { LogIn } from "lucide-react";
import { useState } from "react";
import { DesktopSettingsRow, DesktopSettingsSection as Section } from "@/features/settings";
import { Button } from "@/shared/ui";
import type { EngineId } from "../channels/engines";
import { refreshCliStatus } from "../clis/useCliVersionStatus";
import { SignInDialog } from "../clis/SignInDialog";
import { DshHostSection } from "./DshHostSection";
import { EngineProgramSection } from "./EngineProgramSection";
import { PiFamilyAuthSection } from "./PiFamilyAuthSection";

/**
 * CodeBuddy keeps its sign-in in the OS credential store under names of its own. Telling whether
 * it is signed in would mean searching that store, which Misty never does: the CLI owns the
 * state, and this only opens its `/login`.
 */
function CodeBuddySignIn() {
  const [open, setOpen] = useState(false);
  return (
    <Section title="Account">
      <DesktopSettingsRow label="CodeBuddy account">
        <Button size="sm" variant="primary" onClick={() => setOpen(true)}>
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
