import { pluginCommandRun } from "@/features/files/native";
import type { PluginCommandEntry, PluginPanelEntry } from "@/native/contracts";
import { errorText } from "@/shared/lib/format";
import { Button } from "@/shared/ui";
import { Puzzle, Terminal } from "lucide-react";
import { useCallback, useState } from "react";
import type { PluginTabState } from "../../model/types/workspace/ExplorerDesktopPlugins";
import { pluginTabHostStyles } from "../ExplorerDesktopPluginStyles";
import { cx } from "../ExplorerDesktopShared";
import {
  PluginIcon,
  pluginCommandNeedsSelection,
  pluginCommandOnlyOpensLauncher,
} from "./PluginPanelElementView";
import { extensionAreaLabel, pluginMenuItems, pluginMenuSubtitle } from "./pluginMenu";
import { ExplorerPluginPanelHost } from "./pluginPanelHosts";

export function ExplorerPluginTabHeader(props: {
  tab: PluginTabState;
  commands: PluginCommandEntry[];
  panels: PluginPanelEntry[];
}) {
  const plugin = pluginMenuItems(props.panels, props.commands, props.tab.selectedPath).find(
    (item) => item.pluginId === props.tab.pluginId,
  );
  const title = plugin?.pluginName ?? props.tab.pluginId;
  return (
    <div className={pluginTabHostStyles.header}>
      <div className={pluginTabHostStyles.headerTitle}>
        <PluginIcon
          pluginId={props.tab.pluginId}
          pluginName={title}
          fallback={props.tab.kind}
          size={18}
        />
        <div>
          <strong>{title}</strong>
          <span>{plugin ? pluginMenuSubtitle(plugin) : "Extension"}</span>
        </div>
      </div>
      {plugin ? (
        <span
          className={cx(
            pluginTabHostStyles.statusPill,
            plugin.usable && pluginTabHostStyles.statusPillUsable,
          )}
        >
          {plugin.usable ? "Usable in Files" : `Area: ${extensionAreaLabel(plugin.primaryArea)}`}
        </span>
      ) : null}
    </div>
  );
}

export function ExplorerPluginTabContent(props: {
  tab: PluginTabState;
  commands: PluginCommandEntry[];
  panels: PluginPanelEntry[];
}) {
  const [runningCommandId, setRunningCommandId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const pluginPanels = props.panels.filter((panel) => panel.pluginId === props.tab.pluginId);
  const panel =
    props.tab.kind === "panel"
      ? (pluginPanels.find((candidate) => candidate.id === props.tab.panelId) ?? pluginPanels[0])
      : null;
  const commands = props.commands.filter(
    (command) =>
      command.pluginId === props.tab.pluginId && !pluginCommandOnlyOpensLauncher(command),
  );

  const runCommand = useCallback(
    (command: PluginCommandEntry) => {
      if (pluginCommandNeedsSelection(command, props.tab.selectedPath)) {
        setError(`${command.label}: Select a file before running this command.`);
        return;
      }
      setRunningCommandId(command.id);
      setError("");
      setMessage("");
      void pluginCommandRun({
        commandId: command.id,
        selectedPaths: props.tab.selectedPath ? [props.tab.selectedPath] : [],
      })
        .then((result) => {
          if (result.handled) setMessage(result.message);
          else setError(`${result.label}: ${result.message}`);
        })
        .catch((error) => setError(errorText(error)))
        .finally(() => setRunningCommandId(null));
    },
    [props.tab.selectedPath],
  );

  if (!panel && commands.length === 0) {
    return (
      <div className={pluginTabHostStyles.empty}>
        <Puzzle size={26} />
        <h3>Extension unavailable</h3>
        <p>This extension no longer exposes panels or commands.</p>
      </div>
    );
  }

  return (
    <div className={pluginTabHostStyles.body}>
      {error ? <div className={pluginTabHostStyles.error}>{error}</div> : null}
      {message ? <div className={pluginTabHostStyles.message}>{message}</div> : null}
      {panel ? (
        <ExplorerPluginPanelHost panel={panel} selectedPath={props.tab.selectedPath} />
      ) : null}
      {commands.length > 0 ? (
        <section className={pluginTabHostStyles.commands}>
          <h3>Commands</h3>
          {commands.map((command) => (
            <div key={command.id} className={pluginTabHostStyles.commandRow}>
              <span className={pluginTabHostStyles.commandLabel} title={command.hint}>
                {command.label}
              </span>
              <small>{command.defaultShortcut || command.source}</small>
              {pluginCommandNeedsSelection(command, props.tab.selectedPath) ? (
                <em>Select a file first</em>
              ) : null}
              <Button
                className={pluginTabHostStyles.button}
                type="button"
                disabled={
                  runningCommandId === command.id ||
                  pluginCommandNeedsSelection(command, props.tab.selectedPath)
                }
                onClick={() => runCommand(command)}
              >
                <Terminal size={13} />
                {runningCommandId === command.id ? "Running" : "Run"}
              </Button>
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}
