// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { Check } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { DesktopSettingsRow } from "@/features/settings";
import { Button, SetupState, useNotice, Text } from "@misty/ui";
import { computerUseApi, type ComputerUsePermissions } from "./computer_use_attachment";

function Grant(props: {
  label: string;
  granted: boolean | undefined;
  checkError: string | null;
  onOpen(): void;
  onRetry(): void;
}) {
  return (
    <DesktopSettingsRow label={props.label}>
      {props.granted === undefined ? (
        <SetupState
          size="row"
          tool="permission check"
          label="Checking permissions"
          error={props.checkError}
          onRetry={props.onRetry}
        />
      ) : props.granted ? (
        <Text bare size="control" tone="muted" className="inline-flex items-center gap-1.5">
          <Check aria-hidden />
          Allowed
        </Text>
      ) : (
        <Button onClick={props.onOpen}>Open System Settings</Button>
      )}
    </DesktopSettingsRow>
  );
}

export function ComputerUseSection() {
  const [status, setStatus] = useState<ComputerUsePermissions>();
  const [error, setError] = useState("");
  const [checkError, setCheckError] = useState<string | null>(null);
  const load = useCallback(() => {
    computerUseApi.permissions().then(
      (permissions) => {
        setStatus(permissions);
        setCheckError(null);
      },
      () => setCheckError("The permissions couldn't be checked."),
    );
  }, []);
  const retry = () => {
    setCheckError(null);
    load();
  };
  useEffect(() => {
    load();
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, [load]);
  const open = (kind: "accessibility" | "screenRecording") =>
    computerUseApi.openSettings(kind).catch(() => setError("System Settings couldn't open."));
  useNotice(Boolean(error), { message: error, tone: "error", onDismiss: () => setError("") });
  if (status && !status.osPermissionsRequired) {
    return (
      <DesktopSettingsRow label="Permissions">
        <Text size="control" tone="muted">
          None needed
        </Text>
      </DesktopSettingsRow>
    );
  }
  return (
    <>
      <Grant
        label="Screen Recording"
        granted={status?.screenRecording}
        checkError={checkError}
        onOpen={() => void open("screenRecording")}
        onRetry={retry}
      />
      <Grant
        label="Accessibility"
        granted={status?.accessibility}
        checkError={checkError}
        onOpen={() => void open("accessibility")}
        onRetry={retry}
      />
      <DesktopSettingsRow label="Stop screen control">
        <Button
          onClick={() => void computerUseApi.stop().catch(() => setError("Couldn't stop it."))}
        >
          Stop
        </Button>
      </DesktopSettingsRow>
    </>
  );
}
