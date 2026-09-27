import { openTerminalAtPath } from "@/features/files/workspace/native";
import { reportSystemError } from "@/features/activity";
import { IconButton, toolbarIconProps } from "@/shared/ui";
import { PanelsTopLeft, Terminal } from "lucide-react";
import { useCallback, useState } from "react";

export function ExplorerTray(props: {
  terminalEnabled: boolean;
  terminalPath: string;
  onToggleFileManagerMode: () => void;
}) {
  const [errorMessage, setErrorMessage] = useState("");
  const openTerminal = useCallback(() => {
    if (!props.terminalEnabled) return;
    setErrorMessage("");
    void openTerminalAtPath(props.terminalPath).catch((error: unknown) => {
      setErrorMessage("Terminal could not be opened. Try again.");
      reportSystemError({
        error,
        scope: "files:terminal",
        title: "Terminal could not be opened",
        target: { kind: "workspace-tool", tool: "files" },
      });
    });
  }, [props.terminalEnabled, props.terminalPath]);

  return (
    <>
      {errorMessage ? (
        <span role="alert" className="text-xs text-cream-muted">
          {errorMessage}
        </span>
      ) : null}
      <IconButton label="Open Spaces" tooltip={false} onClick={props.onToggleFileManagerMode}>
        <PanelsTopLeft {...toolbarIconProps} />
      </IconButton>
      <span className="mx-0.5 h-4 w-px bg-charcoal-border" aria-hidden="true" />
      <IconButton
        label="Open terminal"
        tooltip={false}
        title={props.terminalEnabled ? "Open terminal" : "Terminal unavailable for this view"}
        disabled={!props.terminalEnabled}
        onClick={openTerminal}
      >
        <Terminal {...toolbarIconProps} />
      </IconButton>
    </>
  );
}
