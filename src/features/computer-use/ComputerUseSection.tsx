// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
/**
 * Settings › Access › Computer use: the two macOS grants an engine needs to see and work the
 * screen, each with a link to its System Settings pane. A message starts screen control with
 * `/computer`; Escape stops it.
 */
import { Check } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { DesktopSettingsRow } from "@/features/settings";
import { Button, ErrorNotification, Skeleton } from "@/shared/ui";
import { computerUseApi, type ComputerUsePermissions } from "./computerUseAttachment";

function Grant(props: { label: string; granted: boolean | undefined; onOpen(): void }) {
  return (
    <DesktopSettingsRow label={props.label}>
      {props.granted === undefined ? (
        <Skeleton className="h-8 w-28" />
      ) : props.granted ? (
        <span className="inline-flex items-center gap-1.5 text-sm text-cream-muted">
          <Check aria-hidden className="size-4" />
          Allowed
        </span>
      ) : (
        <Button variant="secondary" size="sm" onClick={props.onOpen}>
          Open System Settings
        </Button>
      )}
    </DesktopSettingsRow>
  );
}

export function ComputerUseSection() {
  const [status, setStatus] = useState<ComputerUsePermissions>();
  const [error, setError] = useState("");
  const load = useCallback(() => {
    computerUseApi.permissions().then(setStatus, () => setError("The permissions couldn't load."));
  }, []);
  useEffect(() => {
    load();
    // A grant changes in System Settings; read it again when the person comes back.
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, [load]);
  const open = (kind: "accessibility" | "screenRecording") =>
    computerUseApi.openSettings(kind).catch(() => setError("System Settings couldn't open."));
  if (status && !status.osPermissionsRequired) {
    return (
      <DesktopSettingsRow label="Permissions">
        <span className="text-sm text-cream-muted">None needed</span>
      </DesktopSettingsRow>
    );
  }
  return (
    <>
      <Grant
        label="Screen Recording"
        granted={status?.screenRecording}
        onOpen={() => void open("screenRecording")}
      />
      <Grant
        label="Accessibility"
        granted={status?.accessibility}
        onOpen={() => void open("accessibility")}
      />
      <DesktopSettingsRow label="Stop screen control">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void computerUseApi.stop().catch(() => setError("Couldn't stop it."))}
        >
          Stop
        </Button>
      </DesktopSettingsRow>
      <ErrorNotification message={error} onDismiss={() => setError("")} />
    </>
  );
}
