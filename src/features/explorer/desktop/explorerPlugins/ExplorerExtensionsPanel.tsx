import type { PluginMenuItem } from "@/models/types/features/explorer/desktop/ExplorerDesktopPlugins";
import { Button } from "@/ui";
import { Puzzle, X } from "lucide-react";
import { useMemo } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { cx } from "../ExplorerDesktopShared";
import { extensionsPanelStyles } from "../ExplorerDesktopPluginStyles";
import { PluginIcon } from "./PluginPanelElementView";
import { pluginPanelUsableInCurrentArea } from "./pluginMenu";
import { ExplorerPluginPanelHost } from "./pluginPanelHosts";

export function ExplorerExtensionsPanel(props: {
  openPluginIds: string[];
  plugins: PluginMenuItem[];
  selectedPath: string;
  selectedPluginId: string | null;
  onSelectPlugin: (pluginId: string) => void;
  onClosePlugin: (pluginId: string) => void;
  onClose: () => void;
}) {
  const openPlugins = useMemo(
    () =>
      props.openPluginIds
        .map((pluginId) => props.plugins.find((plugin) => plugin.pluginId === pluginId))
        .filter((plugin): plugin is PluginMenuItem => Boolean(plugin)),
    [props.openPluginIds, props.plugins],
  );
  const selectedPlugin =
    openPlugins.find((plugin) => plugin.pluginId === props.selectedPluginId) ??
    openPlugins[0] ??
    null;
  const selectedPanel = selectedPlugin
    ? (selectedPlugin.panels.find(pluginPanelUsableInCurrentArea) ??
      selectedPlugin.panels[0] ??
      null)
    : null;

  return (
    <aside className={extensionsPanelStyles.root} aria-label="Extensions">
      <header className={extensionsPanelStyles.header}>
        <div className={extensionsPanelStyles.headerTitle}>
          <Puzzle size={17} />
          <div>
            <strong>Extensions</strong>
            <span>{openPlugins.length} open</span>
          </div>
        </div>
        <Button
          className={extensionsPanelStyles.iconButton}
          type="button"
          title="Close extensions"
          onClick={props.onClose}
        >
          <X size={16} />
        </Button>
      </header>
      <div className={extensionsPanelStyles.body}>
        <nav
          className={extensionsPanelStyles.list}
          aria-label="Installed extensions"
          role="tablist"
        >
          {openPlugins.map((plugin) => (
            <Button
              key={plugin.pluginId}
              type="button"
              role="tab"
              aria-selected={selectedPlugin?.pluginId === plugin.pluginId}
              className={cx(
                extensionsPanelStyles.item,
                selectedPlugin?.pluginId === plugin.pluginId && extensionsPanelStyles.itemSelected,
              )}
              onClick={() => props.onSelectPlugin(plugin.pluginId)}
            >
              <PluginIcon
                pluginId={plugin.pluginId}
                pluginName={plugin.pluginName}
                fallback={plugin.kind}
                size={20}
              />
              <span className={extensionsPanelStyles.itemText}>
                <strong>{plugin.pluginName}</strong>
                <small>
                  {plugin.panels[0]?.title ?? (plugin.usable ? "Ready in Files" : "No file panel")}
                </small>
              </span>
              <span
                className={extensionsPanelStyles.tabClose}
                role="button"
                tabIndex={0}
                title={`Close ${plugin.pluginName}`}
                onClick={(event) => {
                  event.stopPropagation();
                  props.onClosePlugin(plugin.pluginId);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    event.stopPropagation();
                    props.onClosePlugin(plugin.pluginId);
                  }
                }}
              >
                <X size={13} />
              </span>
            </Button>
          ))}
        </nav>
        <section className={extensionsPanelStyles.host}>
          {selectedPlugin ? (
            <>
              <div className={extensionsPanelStyles.selectedHeader}>
                <PluginIcon
                  pluginId={selectedPlugin.pluginId}
                  pluginName={selectedPlugin.pluginName}
                  fallback={selectedPlugin.kind}
                  size={24}
                />
                <div className={extensionsPanelStyles.selectedTitle}>
                  <strong>{selectedPlugin.pluginName}</strong>
                  <span>{selectedPanel?.title ?? "No file panel available"}</span>
                </div>
              </div>
              {props.selectedPath ? (
                <div className={extensionsPanelStyles.selectionPill} title={props.selectedPath}>
                  {props.selectedPath}
                </div>
              ) : null}
              {selectedPanel ? (
                <ExplorerPluginPanelHost panel={selectedPanel} selectedPath={props.selectedPath} />
              ) : (
                <div className={extensionsPanelStyles.empty}>
                  <Puzzle size={22} />
                  <span>This extension does not expose a file panel yet.</span>
                </div>
              )}
            </>
          ) : (
            <div className={extensionsPanelStyles.empty}>
              <Puzzle size={24} />
              <span>Choose an extension from the tray dropdown to open it here.</span>
            </div>
          )}
        </section>
      </div>
    </aside>
  );
}

const pluginTabProtocol = "misty-plugin:";
