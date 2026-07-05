import { ArrowRightLeft, ExternalLink, MessageSquare, Puzzle, RefreshCcw, Terminal, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { openTerminalAtPath, pluginCommandRun, pluginPanelRender } from "../../../api/misty";
import type { PluginCommandEntry, PluginPanelElement, PluginPanelEntry, PluginPanelRenderResult, TransferRecord } from "../../../api/types";
import { ExtensionCatalogIcon } from "../../../plugins/ExtensionCatalogIcon";
import { publishPluginNotifications } from "../../../plugins/pluginNotifications";
import { useMultiPanelStore } from "../../../shared/multipanel/useMultiPanelStore";
import { useMinimumSpin } from "../../../shared/hooks/useMinimumSpin";
import { errorText } from "../../../shared/format";
import { applyMistyThemeFromExtensionAction } from "../../../stores/useAppThemeStore";
import { useExplorerStore } from "../../../stores/useExplorerStore";
import { useTransfersStore } from "../../../stores/useTransfersStore";
import { cx } from "./ExplorerDesktopShared";
import { explorerTrayStyles, extensionsPanelStyles, pluginTabHostStyles, pluginTabMenuStyles } from "./ExplorerDesktopPluginStyles";

const transfersTabPath = "misty-transfers://history";
const remotesTabPath = "misty-remotes://manage";

const transferBadgeStatuses = new Set<TransferRecord["status"]>([
  "queued",
  "pending",
  "in_progress",
  "waiting_for_resolution",
  "failed",
  "interrupted",
]);

export function ExplorerTray(props: {
  aiOpen: boolean;
  commands: PluginCommandEntry[];
  panels: PluginPanelEntry[];
  selectedPath: string;
  selectedExtensionPluginId: string | null;
  extensionsOpen: boolean;
  terminalEnabled: boolean;
  terminalPath: string;
  onOpenTransfers: () => void;
  onToggleAi: () => void;
  onToggleExtensionPlugin: (pluginId: string) => void;
}) {
  const openTerminal = useCallback(() => {
    if (!props.terminalEnabled) return;
    void openTerminalAtPath(props.terminalPath).catch((error: unknown) => {
      useExplorerStore.getState().pushNotification(`Terminal unavailable: ${errorText(error)}`, "error", 4500);
    });
  }, [props.terminalEnabled, props.terminalPath]);

  return (
    <>
      <ExplorerTransfersTabButton onClick={props.onOpenTransfers} />
      <button
        className={cx(explorerTrayStyles.trigger, props.aiOpen && explorerTrayStyles.triggerActive)}
        type="button"
        title="Mika AI coming soon"
        aria-label="Mika AI coming soon"
        aria-pressed={props.aiOpen}
        onClick={props.onToggleAi}
      >
        <MessageSquare size={16} />
      </button>
      <button
        className={explorerTrayStyles.trigger}
        type="button"
        title={props.terminalEnabled ? "Open terminal" : "Terminal unavailable for this view"}
        aria-label="Open terminal"
        disabled={!props.terminalEnabled}
        onClick={openTerminal}
      >
        <Terminal size={16} />
      </button>
      <ExplorerPluginTabMenu
        activePluginId={props.selectedExtensionPluginId}
        commands={props.commands}
        extensionsOpen={props.extensionsOpen}
        panels={props.panels}
        selectedPath={props.selectedPath}
        onTogglePlugin={props.onToggleExtensionPlugin}
      />
    </>
  );
}

function ExplorerTransfersTabButton(props: {
  onClick: () => void;
}) {
  const rows = useTransfersStore((state) => state.transfers?.rows ?? []);
  const active = useMultiPanelStore((state) => {
    const tab = state.tabs.find((candidate) => candidate.id === state.activeTabId);
    return Boolean(tab && isTransfersTabPath(tab.path));
  });
  const badgeCount = rows.filter((row) => transferBadgeStatuses.has(row.status)).length;
  return (
    <span className={explorerTrayStyles.triggerWrap}>
      <button
        className={cx(explorerTrayStyles.trigger, active && explorerTrayStyles.triggerActive)}
        type="button"
        title="Transfers"
        aria-label="Transfers"
        onClick={props.onClick}
      >
        <ArrowRightLeft size={16} />
      </button>
      {badgeCount > 0 ? (
        <span className={explorerTrayStyles.badge}>{formatTransferBadgeCount(badgeCount)}</span>
      ) : null}
    </span>
  );
}

function formatTransferBadgeCount(count: number): string {
  return count > 99 ? "99+" : String(count);
}

function ExplorerPluginTabMenu(props: {
  activePluginId: string | null;
  commands: PluginCommandEntry[];
  extensionsOpen: boolean;
  panels: PluginPanelEntry[];
  selectedPath: string;
  onTogglePlugin: (pluginId: string) => void;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const plugins = useMemo(
    () => pluginMenuItems(props.panels, props.commands, props.selectedPath),
    [props.commands, props.panels, props.selectedPath],
  );
  const visiblePlugins = useMemo(
    () => filterPluginMenuItems(plugins, query),
    [plugins, query],
  );
  const highlightedCount = plugins.filter((plugin) => plugin.usable).length;

  const updateMenuPosition = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const width = Math.min(380, Math.max(310, window.innerWidth - 24));
    const left = Math.min(Math.max(12, rect.right - width), Math.max(12, window.innerWidth - width - 12));
    const top = Math.min(rect.bottom + 7, Math.max(12, window.innerHeight - 120));
    setMenuStyle({
      left,
      top,
      width,
      maxHeight: `calc(100vh - ${top + 12}px)`,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updateMenuPosition();
    const handlePointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [open, updateMenuPosition]);

  const togglePluginPanel = useCallback((plugin: PluginMenuItem) => {
    setOpen(false);
    props.onTogglePlugin(plugin.pluginId);
  }, [props.onTogglePlugin]);

  const browsePlugins = useCallback(() => {
    setOpen(false);
    navigate("/extensions");
  }, [navigate]);

  return (
    <>
      <button
        ref={buttonRef}
        className={cx(explorerTrayStyles.trigger, (open || props.extensionsOpen) && explorerTrayStyles.triggerActive)}
        type="button"
        title="Extensions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Puzzle size={16} />
      </button>
      {open ? createPortal((
        <div ref={menuRef} className={pluginTabMenuStyles.menu} style={menuStyle} role="menu" aria-label="Extensions">
          <header className={pluginTabMenuStyles.header}>
            <span className={pluginTabMenuStyles.headerTitle}>
              <Puzzle size={16} />
              <strong>Extensions</strong>
            </span>
            <span className={pluginTabMenuStyles.headerMeta}>{highlightedCount} usable</span>
          </header>
          <label className={pluginTabMenuStyles.searchLabel}>
            <span className="sr-only">Search extensions</span>
            <input
              className={pluginTabMenuStyles.searchInput}
              value={query}
              placeholder="Search extensions..."
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          {plugins.length > 0 ? (
            <div className={pluginTabMenuStyles.sections}>
              {visiblePlugins.map((plugin) => (
                <button
                  key={plugin.pluginId}
                  type="button"
                  className={cx(
                    pluginTabMenuStyles.item,
                    plugin.usable && pluginTabMenuStyles.itemUsable,
                    props.extensionsOpen && props.activePluginId === plugin.pluginId && pluginTabMenuStyles.itemSelected,
                  )}
                  role="menuitem"
                  onClick={() => togglePluginPanel(plugin)}
                >
                  <PluginIcon pluginId={plugin.pluginId} pluginName={plugin.pluginName} fallback={plugin.kind} size={16} />
                  <span className={pluginTabMenuStyles.itemText}>
                    <strong>{plugin.pluginName}</strong>
                    <small>{pluginMenuSubtitle(plugin)}</small>
                  </span>
                  <span className={cx(pluginTabMenuStyles.areaPill, plugin.usable && pluginTabMenuStyles.areaPillUsable)}>
                    {plugin.usable ? "Files" : extensionAreaLabel(plugin.primaryArea)}
                  </span>
                </button>
              ))}
              {visiblePlugins.length === 0 ? (
                <div className={pluginTabMenuStyles.empty}>
                  <Puzzle size={20} />
                  <span>No extensions match the current search.</span>
                </div>
              ) : null}
            </div>
          ) : (
            <div className={pluginTabMenuStyles.empty}>
              <Puzzle size={20} />
              <span>No installed extension panels or commands found.</span>
            </div>
          )}
          <button className={pluginTabMenuStyles.footerItem} type="button" role="menuitem" onClick={browsePlugins}>
            <Puzzle size={15} />
            <span>Browse extensions</span>
          </button>
        </div>
      ), document.body) : null}
    </>
  );
}

export function ExplorerExtensionsPanel(props: {
  openPluginIds: string[];
  plugins: PluginMenuItem[];
  selectedPath: string;
  selectedPluginId: string | null;
  onSelectPlugin: (pluginId: string) => void;
  onClosePlugin: (pluginId: string) => void;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const openPlugins = useMemo(
    () => props.openPluginIds
      .map((pluginId) => props.plugins.find((plugin) => plugin.pluginId === pluginId))
      .filter((plugin): plugin is PluginMenuItem => Boolean(plugin)),
    [props.openPluginIds, props.plugins],
  );
  const selectedPlugin = openPlugins.find((plugin) => plugin.pluginId === props.selectedPluginId)
    ?? openPlugins[0]
    ?? null;
  const selectedPanel = selectedPlugin
    ? selectedPlugin.panels.find(pluginPanelUsableInCurrentArea) ?? selectedPlugin.panels[0] ?? null
    : null;

  const browsePlugins = useCallback(() => {
    navigate("/extensions");
  }, [navigate]);

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
        <button className={extensionsPanelStyles.iconButton} type="button" title="Close extensions" onClick={props.onClose}>
          <X size={16} />
        </button>
      </header>
      <div className={extensionsPanelStyles.body}>
        <nav className={extensionsPanelStyles.list} aria-label="Installed extensions" role="tablist">
          {openPlugins.map((plugin) => (
            <button
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
              <PluginIcon pluginId={plugin.pluginId} pluginName={plugin.pluginName} fallback={plugin.kind} size={20} />
              <span className={extensionsPanelStyles.itemText}>
                <strong>{plugin.pluginName}</strong>
                <small>{plugin.panels[0]?.title ?? (plugin.usable ? "Ready in Files" : "No file panel")}</small>
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
            </button>
          ))}
        </nav>
        <section className={extensionsPanelStyles.host}>
          {selectedPlugin ? (
            <>
              <div className={extensionsPanelStyles.selectedHeader}>
                <PluginIcon pluginId={selectedPlugin.pluginId} pluginName={selectedPlugin.pluginName} fallback={selectedPlugin.kind} size={24} />
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
                <ExplorerPluginPanelHost
                  panel={selectedPanel}
                  selectedPath={props.selectedPath}
                />
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
      <button className={extensionsPanelStyles.footerButton} type="button" onClick={browsePlugins}>
        Manage extensions
        <ExternalLink size={14} />
      </button>
    </aside>
  );
}

export type PluginMenuItem = {
  pluginId: string;
  pluginName: string;
  panels: PluginPanelEntry[];
  commands: PluginCommandEntry[];
  usable: boolean;
  primaryArea: string;
  kind: "panel" | "commands";
};

export type PluginTabState = {
  kind: "panel" | "commands";
  pluginId: string;
  panelId: string;
  selectedPath: string;
};

const pluginTabProtocol = "misty-plugin:";
const currentPluginArea = "files";

export function pluginMenuItems(
  panels: PluginPanelEntry[],
  commands: PluginCommandEntry[],
  selectedPath: string,
): PluginMenuItem[] {
  const grouped = new Map<string, PluginMenuItem>();
  for (const panel of panels) {
    const item = grouped.get(panel.pluginId) ?? createPluginMenuItem(panel.pluginId, panel.pluginName);
    item.panels.push(panel);
    item.pluginName = panel.pluginName || item.pluginName;
    grouped.set(panel.pluginId, item);
  }
  for (const command of commands) {
    if (pluginCommandOnlyOpensLauncher(command)) continue;
    const item = grouped.get(command.pluginId) ?? createPluginMenuItem(command.pluginId, command.pluginName);
    item.commands.push(command);
    item.pluginName = command.pluginName || item.pluginName;
    grouped.set(command.pluginId, item);
  }

  return Array.from(grouped.values())
    .map((item) => {
      const usablePanels = item.panels.filter(pluginPanelUsableInCurrentArea);
      const usableCommands = item.commands.filter((command) => !pluginCommandNeedsSelection(command, selectedPath));
      const primaryPanel = usablePanels[0] ?? item.panels[0];
      const primaryArea = primaryPanel?.launcherViews[0] ?? "Other";
      return {
        ...item,
        panels: item.panels.slice().sort((left, right) => left.title.localeCompare(right.title)),
        commands: item.commands.slice().sort((left, right) => left.label.localeCompare(right.label)),
        usable: usablePanels.length > 0 || usableCommands.length > 0,
        primaryArea,
        kind: primaryPanel ? "panel" as const : "commands" as const,
      };
    })
    .sort((left, right) => Number(right.usable) - Number(left.usable) || left.pluginName.localeCompare(right.pluginName));
}

function createPluginMenuItem(pluginId: string, pluginName: string): PluginMenuItem {
  return {
    pluginId,
    pluginName: pluginName || pluginId,
    panels: [],
    commands: [],
    usable: false,
    primaryArea: "Other",
    kind: "commands",
  };
}

function filterPluginMenuItems(items: PluginMenuItem[], query: string): PluginMenuItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return items;
  return items.filter((item) =>
    [
      item.pluginId,
      item.pluginName,
      item.primaryArea,
      ...item.panels.flatMap((panel) => [panel.id, panel.title, panel.launcherViews.join(" ")]),
      ...item.commands.flatMap((command) => [command.id, command.label, command.hint]),
    ].join(" ").toLowerCase().includes(needle)
  );
}

function pluginPanelUsableInCurrentArea(panel: PluginPanelEntry): boolean {
  if (panel.launcherViews.length === 0) return true;
  return panel.launcherViews.some((view) => {
    const area = normalizedPluginArea(view);
    return area === "all" || area === currentPluginArea;
  });
}

function normalizedPluginArea(area: string): string {
  const normalized = area.trim().toLowerCase();
  if (normalized === "explorer") return "files";
  return normalized;
}

export function stringArraysEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function extensionAreaLabel(area: string): string {
  return normalizedPluginArea(area) === "plugins" ? "Extensions" : area;
}

function pluginMenuSubtitle(plugin: PluginMenuItem): string {
  const panelCount = plugin.panels.length;
  const commandCount = plugin.commands.length;
  if (panelCount && commandCount) return `${panelCount} panel${panelCount === 1 ? "" : "s"} · ${commandCount} command${commandCount === 1 ? "" : "s"}`;
  if (panelCount) return `${panelCount} panel${panelCount === 1 ? "" : "s"}`;
  return `${commandCount} command${commandCount === 1 ? "" : "s"}`;
}

function pluginTabPathForMenuItem(plugin: PluginMenuItem, selectedPath: string): string {
  const usablePanel = plugin.panels.find(pluginPanelUsableInCurrentArea);
  const panel = usablePanel ?? plugin.panels[0];
  const params = new URLSearchParams({ plugin: plugin.pluginId });
  if (selectedPath.trim()) params.set("selected", selectedPath);
  if (panel) {
    params.set("panel", panel.id);
    return `${pluginTabProtocol}//panel?${params.toString()}`;
  }
  return `${pluginTabProtocol}//commands?${params.toString()}`;
}

export function isTransfersTabPath(path: string): boolean {
  return path === transfersTabPath;
}

export function isRemotesTabPath(path: string): boolean {
  return path === remotesTabPath;
}

export function isChromeTabPath(path: string): boolean {
  return isTransfersTabPath(path) || isRemotesTabPath(path);
}

export function canOpenTerminalPath(path: string): boolean {
  const trimmed = path.trim();
  return Boolean(trimmed) && !trimmed.includes("://");
}

export function openTransfersTab(): void {
  const multi = useMultiPanelStore.getState();
  const existing = multi.tabs.find((tab) => isTransfersTabPath(tab.path));
  if (existing) {
    multi.selectTab(existing.id);
    return;
  }
  const tabId = multi.addTab(transfersTabPath, "Transfers");
  useMultiPanelStore.getState().setTabPanelVisibility(tabId, { sidebarVisible: false, previewVisible: false });
}

export function openRemotesTab(): void {
  const multi = useMultiPanelStore.getState();
  const existing = multi.tabs.find((tab) => isRemotesTabPath(tab.path));
  if (existing) {
    multi.selectTab(existing.id);
    return;
  }
  const tabId = multi.addTab(remotesTabPath, "Remotes");
  useMultiPanelStore.getState().setTabPanelVisibility(tabId, { sidebarVisible: false, previewVisible: false });
}

export function toggleActiveTabPanelVisibility(panel: "sidebar" | "preview"): void {
  const multi = useMultiPanelStore.getState();
  const activeTab = multi.tabs.find((tab) => tab.id === multi.activeTabId) ?? multi.tabs[0];
  if (!activeTab || isChromeTabPath(activeTab.path)) return;
  if (panel === "sidebar") {
    multi.setTabPanelVisibility(activeTab.id, { sidebarVisible: !(activeTab.sidebarVisible ?? true) });
  } else {
    multi.setTabPanelVisibility(activeTab.id, { previewVisible: !(activeTab.previewVisible ?? true) });
  }
}

export function parsePluginTabPath(path: string): PluginTabState | null {
  if (!path.startsWith(pluginTabProtocol)) return null;
  try {
    const url = new URL(path);
    const pluginId = url.searchParams.get("plugin") ?? "";
    if (!pluginId) return null;
    return {
      kind: url.hostname === "commands" ? "commands" : "panel",
      pluginId,
      panelId: url.searchParams.get("panel") ?? "",
      selectedPath: url.searchParams.get("selected") ?? "",
    };
  } catch {
    return null;
  }
}

export function ExplorerPluginTabHeader(props: {
  tab: PluginTabState;
  commands: PluginCommandEntry[];
  panels: PluginPanelEntry[];
}) {
  const plugin = pluginMenuItems(props.panels, props.commands, props.tab.selectedPath)
    .find((item) => item.pluginId === props.tab.pluginId);
  const title = plugin?.pluginName ?? props.tab.pluginId;
  return (
    <div className={pluginTabHostStyles.header}>
      <div className={pluginTabHostStyles.headerTitle}>
        <PluginIcon pluginId={props.tab.pluginId} pluginName={title} fallback={props.tab.kind} size={18} />
        <div>
          <strong>{title}</strong>
          <span>{plugin ? pluginMenuSubtitle(plugin) : "Extension"}</span>
        </div>
      </div>
      {plugin ? (
        <span className={cx(pluginTabHostStyles.statusPill, plugin.usable && pluginTabHostStyles.statusPillUsable)}>
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
  const panel = props.tab.kind === "panel"
    ? pluginPanels.find((candidate) => candidate.id === props.tab.panelId) ?? pluginPanels[0]
    : null;
  const commands = props.commands.filter((command) =>
    command.pluginId === props.tab.pluginId && !pluginCommandOnlyOpensLauncher(command)
  );

  const runCommand = useCallback((command: PluginCommandEntry) => {
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
        publishPluginNotifications(result.notifications, result.message);
        if (result.handled) setMessage(result.message);
        else setError(`${result.label}: ${result.message}`);
      })
      .catch((error) => setError(errorText(error)))
      .finally(() => setRunningCommandId(null));
  }, [props.tab.selectedPath]);

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
        <ExplorerPluginPanelHost
          panel={panel}
          selectedPath={props.tab.selectedPath}
        />
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
              <button
                className={pluginTabHostStyles.button}
                type="button"
                disabled={runningCommandId === command.id || pluginCommandNeedsSelection(command, props.tab.selectedPath)}
                onClick={() => runCommand(command)}
              >
                <Terminal size={13} />
                {runningCommandId === command.id ? "Running" : "Run"}
              </button>
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}

function ExplorerPluginPanelHost(props: {
  panel: PluginPanelEntry;
  selectedPath: string;
}) {
  const [rendered, setRendered] = useState<PluginPanelRenderResult | null>(null);
  const [rendering, setRendering] = useState(false);
  const [renderError, setRenderError] = useState("");
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [refreshSpinning, startRefreshSpin] = useMinimumSpin(rendering);

  const renderPanel = useCallback((clickedButton = "") => {
    setRendering(true);
    setRenderError("");
    void pluginPanelRender({
      panelId: props.panel.id,
      pluginId: props.panel.pluginId,
      selectedPaths: props.selectedPath ? [props.selectedPath] : [],
      clickedButton,
      inputs,
    })
      .then((result) => {
        setRendered(result);
        if (props.panel.pluginId === "themes" && clickedButton) {
          applyMistyThemeFromExtensionAction(clickedButton);
        }
        publishPluginNotifications(result.notifications);
      })
      .catch((error) => setRenderError(errorText(error)))
      .finally(() => setRendering(false));
  }, [inputs, props.panel.id, props.panel.pluginId, props.selectedPath]);

  useEffect(() => {
    setInputs({});
    setRendered(null);
    setRenderError("");
    setRendering(true);
    void pluginPanelRender({
      panelId: props.panel.id,
      pluginId: props.panel.pluginId,
      selectedPaths: props.selectedPath ? [props.selectedPath] : [],
    })
      .then((result) => {
        setRendered(result);
        publishPluginNotifications(result.notifications);
      })
      .catch((error) => setRenderError(errorText(error)))
      .finally(() => setRendering(false));
  }, [props.panel.id, props.panel.pluginId, props.selectedPath]);

  return (
    <section className={pluginTabHostStyles.panel}>
      <header className={pluginTabHostStyles.panelHeader}>
        <div>
          <h3>{rendered?.title ?? props.panel.title}</h3>
          <span>{props.panel.pluginName}</span>
        </div>
        <button
          className={pluginTabHostStyles.button}
          type="button"
          onClick={() => {
            startRefreshSpin();
            renderPanel();
          }}
          disabled={rendering}
        >
          <RefreshCcw className={refreshSpinning ? "animate-spin" : undefined} size={13} />
          Refresh
        </button>
      </header>
      {renderError ? <div className={pluginTabHostStyles.error}>{renderError}</div> : null}
      {rendered && rendered.runtimeStatus !== "native_rendered" ? (
        <div className={pluginTabHostStyles.notice}>
          <Puzzle size={20} />
          <span>{rendered.message || "Extension panel unavailable."}</span>
        </div>
      ) : null}
      {!rendered && !renderError ? <div className={pluginTabHostStyles.loading}>Loading extension panel...</div> : null}
      {rendered?.runtimeStatus === "native_rendered" ? (
        <div className={pluginTabHostStyles.elements}>
          {rendered.elements.map((element) => (
            <PluginPanelElementView
              key={element.id}
              element={element}
              value={inputs[element.id] ?? element.text}
              disabled={rendering}
              onInput={(value) => setInputs((current) => ({ ...current, [element.id]: value }))}
              onButton={() => renderPanel(element.id)}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function PluginPanelElementView(props: {
  element: PluginPanelElement;
  value: string;
  disabled: boolean;
  onInput: (value: string) => void;
  onButton: () => void;
}) {
  if (props.element.kind === "button") {
    return (
      <button className={pluginTabHostStyles.button} type="button" disabled={props.disabled} onClick={props.onButton}>
        {props.element.text || props.element.id}
      </button>
    );
  }
  if (props.element.kind === "input" || props.element.kind === "inputText") {
    return (
      <input
        className={pluginTabHostStyles.input}
        value={props.value}
        disabled={props.disabled}
        placeholder={props.element.text}
        onChange={(event) => props.onInput(event.target.value)}
      />
    );
  }
  if (props.element.kind === "separator") return <hr className={pluginTabHostStyles.separator} />;
  if (props.element.kind === "spacing") return <span className={pluginTabHostStyles.spacing} aria-hidden="true" />;
  if (props.element.kind === "image") return <div className={pluginTabHostStyles.image}>Texture {props.element.id}</div>;
  return <p className={pluginTabHostStyles.text}>{props.element.text}</p>;
}

function pluginCommandOnlyOpensLauncher(command: PluginCommandEntry): boolean {
  if (command.source === "launcher" || command.actionKind === "open") return true;
  const label = command.label.trim();
  return label === "Open" || label.endsWith(": Open");
}

function pluginCommandNeedsSelection(command: PluginCommandEntry, selectedPath: string): boolean {
  return command.requiresSelectedFile && !selectedPath.trim();
}

function PluginIcon(props: {
  pluginId: string;
  pluginName?: string;
  fallback: "panel" | "commands";
  size: number;
}) {
  return (
    <ExtensionCatalogIcon
      pluginId={props.pluginId}
      pluginName={props.pluginName}
      size={Math.max(props.size + 4, 20)}
      roundedClassName="rounded-md"
      textClassName="text-[8px] font-bold text-white"
    />
  );
}
