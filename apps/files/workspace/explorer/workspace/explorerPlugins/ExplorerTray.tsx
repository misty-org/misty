import { openTerminalAtPath } from "@/features/files/native";
import { reportSystemError } from "@/features/activity";
import { Button } from "@/shared/ui";
import { PanelsTopLeft, Terminal } from "lucide-react";
import { useCallback } from "react";
import { explorerTrayStyles } from "../ExplorerDesktopPluginStyles";

export function ExplorerTray(props: {
  terminalEnabled: boolean;
  terminalPath: string;
  onToggleFileManagerMode: () => void;
}) {
  const openTerminal = useCallback(() => {
    if (!props.terminalEnabled) return;
    void openTerminalAtPath(props.terminalPath).catch((error: unknown) => {
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
      <Button
        className={explorerTrayStyles.trigger}
        type="button"
        title="Open Spaces"
        aria-label="Open Spaces"
        onClick={props.onToggleFileManagerMode}
      >
        <PanelsTopLeft size={16} />
      </Button>
      <span className="mx-0.5 h-4 w-px bg-charcoal-border" aria-hidden="true" />
      <Button
        className={explorerTrayStyles.trigger}
        type="button"
        title={props.terminalEnabled ? "Open terminal" : "Terminal unavailable for this view"}
        aria-label="Open terminal"
        disabled={!props.terminalEnabled}
        onClick={openTerminal}
      >
        <Terminal size={16} />
      </Button>
    </>
  );
}
