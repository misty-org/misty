import { ArrowLeft, ArrowRightLeft, ExternalLink, Puzzle, RefreshCcw, Sparkles, Terminal, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CSSProperties } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { extensionCommandRun, openTerminalAtPath, pluginCommandRun, pluginPanelRender } from "../../../api/misty";
import type { PluginCommandEntry, PluginPanelElement, PluginPanelEntry, PluginPanelRenderResult, TransferRecord } from "../../../api/types";
import { ExtensionCatalogIcon } from "../../../plugins/ExtensionCatalogIcon";
import { publishPluginNotifications } from "../../../plugins/pluginNotifications";
import { useMultiPanelStore } from "../../../shared/multipanel/useMultiPanelStore";
import { useMinimumSpin } from "../../../shared/hooks/useMinimumSpin";
import { errorText } from "../../../shared/format";
import { applyMistyThemeFromExtensionAction, themeBaseMode, useAppThemeStore } from "../../../stores/useAppThemeStore";
import type { MistyCustomThemeTokens, MistyThemeId } from "../../../stores/useAppThemeStore";
import { hasTauriInternals } from "../../../shared/tauri";
import { useExplorerStore } from "../../../stores/useExplorerStore";
import { useTransfersStore } from "../../../stores/useTransfersStore";
import { cx } from "./ExplorerDesktopShared";
import { explorerTrayStyles, extensionsPanelStyles, pluginTabHostStyles, pluginTabMenuStyles } from "./ExplorerDesktopPluginStyles";

const transfersTabPath = "misty-transfers://history";
const remotesTabPath = "misty-remotes://manage";
const monitoredExtensionJobs = new Map<string, number>();

function monitorExtensionJob(pluginId: string, pluginName: string, jobId: string) {
  const key = `${pluginId}:${jobId}`;
  if (monitoredExtensionJobs.has(key)) return;
  const poll = () => {
    void extensionCommandRun({ pluginId, command: "jobs.status", payload: { jobId } })
      .then((result) => {
        const snapshot = result as { status?: string; message?: string; error?: string };
        if (snapshot.status === "queued" || snapshot.status === "running") {
          monitoredExtensionJobs.set(key, window.setTimeout(poll, 1_200));
          return;
        }
        monitoredExtensionJobs.delete(key);
        const successful = snapshot.status === "completed";
        useExplorerStore.getState().pushNotification(
          snapshot.error || snapshot.message || `${pluginName} job ${successful ? "completed" : "stopped"}.`,
          successful ? "success" : "error",
          5_500,
        );
      })
      .catch(() => {
        monitoredExtensionJobs.set(key, window.setTimeout(poll, 2_000));
      });
  };
  monitoredExtensionJobs.set(key, window.setTimeout(poll, 800));
}

const transferBadgeStatuses = new Set<TransferRecord["status"]>([
  "queued",
  "pending",
  "in_progress",
  "waiting_for_resolution",
  "failed",
  "interrupted",
]);
const emptyTransferRows: TransferRecord[] = [];

export function ExplorerTray(props: {
  commands: PluginCommandEntry[];
  panels: PluginPanelEntry[];
  extensionsEnabled?: boolean;
  selectedPath: string;
  terminalEnabled: boolean;
  terminalPath: string;
  mikaEnabled: boolean;
  onOpenMika: () => void;
  onOpenTransfers: () => void;
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
        aria-label="Open Mika Assistant"
        className={explorerTrayStyles.trigger}
        disabled={!props.mikaEnabled}
        onClick={props.onOpenMika}
        title={props.mikaEnabled ? "Open Mika Assistant" : "Enable Mika in Settings"}
        type="button"
      >
        <Sparkles size={16} />
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
      {props.extensionsEnabled !== false ? (
        <ExplorerPluginTabMenu
          commands={props.commands}
          panels={props.panels}
          selectedPath={props.selectedPath}
        />
      ) : null}
    </>
  );
}

function ExplorerTransfersTabButton(props: {
  onClick: () => void;
}) {
  const rows = useTransfersStore((state) => state.transfers?.rows ?? emptyTransferRows);
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
  commands: PluginCommandEntry[];
  panels: PluginPanelEntry[];
  selectedPath: string;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [selectedPluginId, setSelectedPluginId] = useState<string | null>(null);
  const [visitedPluginIds, setVisitedPluginIds] = useState<string[]>([]);
  const [requestedSelectedPath, setRequestedSelectedPath] = useState("");
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
  const selectedPlugin = plugins.find((plugin) => plugin.pluginId === selectedPluginId) ?? null;
  const selectedPath = requestedSelectedPath || props.selectedPath;

  const closePopup = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => buttonRef.current?.focus());
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const pluginId = params.get("extension");
    if (!pluginId) return;
    setSelectedPluginId(pluginId);
    setVisitedPluginIds((current) => current.includes(pluginId) ? current : [...current, pluginId]);
    setRequestedSelectedPath(params.get("selected") ?? "");
    setOpen(true);
    params.delete("extension");
    params.delete("selected");
    navigate({ pathname: location.pathname, search: params.toString() ? `?${params}` : "" }, { replace: true });
  }, [location.pathname, location.search, navigate]);

  const updateMenuPosition = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const preferredWidth = selectedPluginId ? 600 : 360;
    const minimumWidth = selectedPluginId ? 420 : 320;
    const width = Math.min(preferredWidth, Math.max(Math.min(minimumWidth, window.innerWidth - 24), window.innerWidth - 24));
    const left = Math.min(Math.max(12, rect.right - width), Math.max(12, window.innerWidth - width - 12));
    const top = Math.min(rect.bottom + 7, Math.max(12, window.innerHeight - 120));
    setMenuStyle({
      left,
      top,
      width,
      maxHeight: `calc(100vh - ${top + 12}px)`,
    });
  }, [selectedPluginId]);

  useLayoutEffect(() => {
    if (!open) return;
    updateMenuPosition();
    const focusFrame = window.requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLElement>("[data-extension-popup-initial]")?.focus();
    });
    const handlePointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      closePopup(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePopup();
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [closePopup, open, updateMenuPosition]);

  const selectPlugin = useCallback((plugin: PluginMenuItem) => {
    setSelectedPluginId(plugin.pluginId);
    setVisitedPluginIds((current) => current.includes(plugin.pluginId) ? current : [...current, plugin.pluginId]);
  }, []);

  const handleMenuKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!(["ArrowDown", "ArrowUp", "Home", "End"] as string[]).includes(event.key)) return;
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
      .filter((item) => !item.hasAttribute("disabled") && item.offsetParent !== null);
    if (items.length === 0) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "Home" ? 0
      : event.key === "End" ? items.length - 1
        : event.key === "ArrowUp" ? (current <= 0 ? items.length - 1 : current - 1)
          : (current + 1) % items.length;
    items[next]?.focus();
  }, []);

  const browsePlugins = useCallback(() => {
    closePopup(false);
    navigate("/extensions");
  }, [closePopup, navigate]);

  return (
    <>
      <button
        ref={buttonRef}
        className={cx(explorerTrayStyles.trigger, open && explorerTrayStyles.triggerActive)}
        type="button"
        title="Extensions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setRequestedSelectedPath("");
          setOpen((current) => !current);
        }}
      >
        <Puzzle size={16} />
      </button>
      {(open || visitedPluginIds.length > 0) ? createPortal((
        <div
          ref={menuRef}
          className={pluginTabMenuStyles.menu}
          style={{ ...menuStyle, display: open ? undefined : "none" }}
          role={selectedPlugin ? "dialog" : "menu"}
          aria-label={selectedPlugin ? `${selectedPlugin.pluginName} extension` : "Extensions"}
          aria-hidden={!open}
          onKeyDown={handleMenuKeyDown}
        >
          <header className={pluginTabMenuStyles.header}>
            <span className={pluginTabMenuStyles.headerTitle}>
              {selectedPlugin ? (
                <button data-extension-popup-initial className={pluginTabMenuStyles.iconButton} type="button" title="Back to extensions" onClick={() => setSelectedPluginId(null)}>
                  <ArrowLeft size={16} />
                </button>
              ) : <Puzzle size={16} />}
              {selectedPlugin ? <PluginIcon pluginId={selectedPlugin.pluginId} pluginName={selectedPlugin.pluginName} fallback={selectedPlugin.kind} size={18} /> : null}
              <strong>{selectedPlugin?.pluginName ?? "Extensions"}</strong>
            </span>
            {selectedPlugin ? (
              <button className={pluginTabMenuStyles.iconButton} type="button" title="Close extensions" onClick={() => closePopup()}>
                <X size={16} />
              </button>
            ) : <span className={pluginTabMenuStyles.headerMeta}>{highlightedCount} usable</span>}
          </header>
          {!selectedPlugin ? <label className={pluginTabMenuStyles.searchLabel}>
            <span className="sr-only">Search extensions</span>
            <input
              className={pluginTabMenuStyles.searchInput}
              data-extension-popup-initial
              value={query}
              placeholder="Search extensions..."
              onChange={(event) => setQuery(event.target.value)}
            />
          </label> : null}
          {!selectedPlugin && plugins.length > 0 ? (
            <div className={pluginTabMenuStyles.sections}>
              {visiblePlugins.map((plugin) => (
                <button
                  key={plugin.pluginId}
                  type="button"
                  className={cx(
                    pluginTabMenuStyles.item,
                    plugin.usable && pluginTabMenuStyles.itemUsable,
                  )}
                  role="menuitem"
                  onClick={() => selectPlugin(plugin)}
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
          ) : !selectedPlugin ? (
            <div className={pluginTabMenuStyles.empty}>
              <Puzzle size={20} />
              <span>No installed extension panels or commands found.</span>
            </div>
          ) : null}
          {visitedPluginIds.map((pluginId) => {
            const plugin = plugins.find((candidate) => candidate.pluginId === pluginId);
            if (!plugin) return null;
            const panel = plugin.panels.find(pluginPanelUsableInCurrentArea) ?? plugin.panels[0] ?? null;
            return (
              <div key={pluginId} className={pluginTabMenuStyles.detail} hidden={selectedPluginId !== pluginId}>
                <div className={pluginTabMenuStyles.selection} title={selectedPath || "No file selected"}>
                  <span>Selected file</span>
                  <strong>{selectedPath || "No file selected"}</strong>
                </div>
                {panel ? <ExplorerPluginPanelHost panel={panel} selectedPath={selectedPath} /> : null}
                {plugin.commands.length > 0 ? (
                  <ExplorerPluginTabContent
                    tab={{ kind: "commands", pluginId: plugin.pluginId, panelId: "", selectedPath }}
                    commands={plugin.commands}
                    panels={[]}
                  />
                ) : null}
                {!panel && plugin.commands.length === 0 ? (
                  <div className={pluginTabHostStyles.empty}><Puzzle size={24} /><h3>Extension unavailable</h3><p>No supported panel or commands were found.</p></div>
                ) : null}
              </div>
            );
          })}
          <button className={pluginTabMenuStyles.footerItem} type="button" role="menuitem" onClick={browsePlugins}>
            <ExternalLink size={15} />
            <span>{selectedPlugin ? "Manage extension" : "Browse extensions"}</span>
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
  if (props.panel.webEntry) return <ExplorerWebPluginPanelHost panel={props.panel} selectedPath={props.selectedPath} />;
  return <ExplorerNativePluginPanelHost panel={props.panel} selectedPath={props.selectedPath} />;
}

function ExplorerNativePluginPanelHost(props: {
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

const themeTokenProperties = {
  background: "--misty-bg", surface: "--misty-surface", foreground: "--misty-text",
  muted: "--misty-text-muted", accent: "--misty-accent", selection: "--misty-selection",
  success: "--misty-success", warning: "--misty-warning", danger: "--misty-danger",
} as const;

function readThemeTokens(): MistyCustomThemeTokens {
  const styles = getComputedStyle(document.documentElement);
  return Object.fromEntries(Object.entries(themeTokenProperties).map(([token, property]) => [token, styles.getPropertyValue(property).trim()])) as MistyCustomThemeTokens;
}

function applyThemeTokenPreview(tokens: MistyCustomThemeTokens | null) {
  const root = document.documentElement;
  for (const [token, property] of Object.entries(themeTokenProperties)) {
    const value = tokens?.[token as keyof MistyCustomThemeTokens];
    if (value) root.style.setProperty(property, value);
    else root.style.removeProperty(property);
  }
}

function safeThemeTokens(value: unknown): MistyCustomThemeTokens | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result: MistyCustomThemeTokens = {};
  for (const token of Object.keys(themeTokenProperties) as Array<keyof MistyCustomThemeTokens>) {
    const color = (value as Record<string, unknown>)[token];
    if (color === undefined) continue;
    if (typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color)) return null;
    result[token] = color.toUpperCase();
  }
  return Object.keys(result).length ? result : null;
}

function isMistyThemeId(value: unknown): value is MistyThemeId {
  return value === "misty-dark" || value === "misty-light" || value === "graphite" || value === "aurora" || value === "copper";
}

function webPanelUrl(panel: PluginPanelEntry): string {
  const [path, query = ""] = panel.webEntry.split("?", 2);
  const params = new URLSearchParams(query);
  params.set("hosted", "1");
  if (!hasTauriInternals()) return `${path}?${params.toString()}`;
  const pluginRoot = panel.pluginDir.replace(/\\/g, "/").replace(/\/$/, "");
  const normalizedPath = path.replace(/\\/g, "/");
  if (!normalizedPath.startsWith(`${pluginRoot}/`)) return "about:blank";
  const rootKind = pluginRoot.includes("/plugins/private/") ? "private"
    : pluginRoot.includes("/plugins/public/") ? "public"
      : "";
  if (!rootKind) return "about:blank";
  const relative = normalizedPath.slice(pluginRoot.length + 1);
  const safeSegments = relative.split("/").filter(Boolean);
  if (safeSegments.length === 0 || safeSegments.some((segment) => segment === "." || segment === "..")) return "about:blank";
  const route = [rootKind, panel.pluginId, ...safeSegments].map(encodeURIComponent).join("/");
  const base = navigator.userAgent.includes("Windows")
    ? "http://misty-extension.localhost"
    : "misty-extension://localhost";
  return `${base}/${route}?${params.toString()}`;
}

function ExplorerWebPluginPanelHost(props: { panel: PluginPanelEntry; selectedPath: string }) {
  const navigate = useNavigate();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [hostState, setHostState] = useState<"loading" | "ready" | "failed">("loading");
  const timeoutRef = useRef<number | null>(null);
  const source = useMemo(() => webPanelUrl(props.panel), [props.panel, reloadKey]);

  useEffect(() => () => {
    if (props.panel.pluginId !== "themes") return;
    const current = useAppThemeStore.getState();
    const root = document.documentElement;
    root.dataset.theme = current.resolvedTheme; root.dataset.mistyTheme = current.themeId;
    root.style.colorScheme = current.resolvedTheme;
    applyThemeTokenPreview(current.customTokens);
  }, [props.panel.pluginId]);

  const postContext = useCallback(() => {
    if (hostState !== "ready") return;
    iframeRef.current?.contentWindow?.postMessage({
      channel: "misty-host", kind: "context", pluginId: props.panel.pluginId,
      selectedPaths: props.selectedPath ? [props.selectedPath] : [],
    }, "*");
  }, [hostState, props.panel.pluginId, props.selectedPath]);

  const beginHandshake = useCallback(() => {
    setHostState("loading");
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => setHostState("failed"), 8_000);
  }, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const request = event.data as { channel?: string; kind?: string; requestId?: string; pluginId?: string; protocolVersion?: number; command?: string; payload?: Record<string, unknown> } | null;
      if (!request || request.channel !== "misty-plugin" || request.pluginId !== props.panel.pluginId) return;
      if (request.kind === "ready" && request.protocolVersion === 1) {
        if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
        setHostState("ready");
        return;
      }
      if (request.kind !== "request" || typeof request.requestId !== "string" || typeof request.command !== "string") return;
      const respond = (ok: boolean, result?: unknown, error?: string) => iframeRef.current?.contentWindow?.postMessage({ channel: "misty-host", kind: "response", requestId: request.requestId, ok, result, error }, "*");
      const payload = request.payload ?? {};
      if (request.command === "host.selectedPaths") { respond(true, { ok: true, selectedPaths: props.selectedPath ? [props.selectedPath] : [] }); return; }
      if (request.command === "host.notify") {
        const level = payload.level === "success" || payload.level === "error" ? payload.level : "info";
        const message = typeof payload.message === "string" ? payload.message.slice(0, 500) : "Extension notification";
        useExplorerStore.getState().pushNotification(message, level, 4500); respond(true, { ok: true }); return;
      }
      if (props.panel.pluginId === "themes") {
        void handleThemeWebCommand(request.command, payload).then((result) => respond(true, result)).catch((error) => respond(false, undefined, errorText(error)));
        return;
      }
      void extensionCommandRun({ pluginId: props.panel.pluginId, command: request.command, payload })
        .then((result) => {
          const started = result as { jobId?: string };
          if (typeof started.jobId === "string" && started.jobId) {
            monitorExtensionJob(props.panel.pluginId, props.panel.pluginName, started.jobId);
          }
          respond(true, result);
        }).catch((error) => respond(false, undefined, errorText(error)));
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [props.panel.pluginId, props.selectedPath]);

  useEffect(postContext, [postContext]);
  useEffect(() => {
    beginHandshake();
    return () => {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    };
  }, [beginHandshake, reloadKey]);
  return (
    <section className={`${pluginTabHostStyles.panel} relative min-h-[360px] overflow-hidden p-0`}>
      {hostState !== "ready" ? (
        <div className="absolute inset-0 z-10 grid content-center justify-items-center gap-3 bg-[var(--misty-bg)] p-5 text-center text-sm text-[#adadad]">
          {hostState === "loading" ? <><RefreshCcw className="animate-spin" size={20} /><span>Loading extension…</span></> : (
            <>
              <Puzzle size={24} />
              <strong className="text-[#eeeeee]">Extension did not start</strong>
              <span>The panel bundle may be missing, outdated, or incompatible with this Misty version.</span>
              <div className="flex flex-wrap justify-center gap-2">
                <button className={pluginTabHostStyles.button} type="button" onClick={() => setReloadKey((value) => value + 1)}><RefreshCcw size={13} />Retry</button>
                <button className={pluginTabHostStyles.button} type="button" onClick={() => navigate("/extensions")}><ExternalLink size={13} />Manage Extension</button>
              </div>
              <code className="max-w-full overflow-hidden text-ellipsis text-[10px] text-[#777]">{props.panel.webEntry}</code>
            </>
          )}
        </div>
      ) : null}
      <iframe key={reloadKey} ref={iframeRef} className="h-full min-h-[420px] w-full border-0 bg-[var(--misty-bg)]" src={source} title={`${props.panel.title} extension`} sandbox="allow-scripts allow-same-origin" onLoad={beginHandshake} />
    </section>
  );
}

async function handleThemeWebCommand(command: string, payload: Record<string, unknown>) {
  const store = useAppThemeStore.getState();
  if (command === "themes.snapshot") return { ok: true, themeId: store.themeId, tokens: store.customTokens ?? readThemeTokens() };
  if (command === "themes.applyPreset") {
    if (!isMistyThemeId(payload.preset)) throw new Error("Unsupported theme preset.");
    const root = document.documentElement;
    root.dataset.theme = themeBaseMode(payload.preset);
    root.dataset.mistyTheme = payload.preset;
    root.style.colorScheme = themeBaseMode(payload.preset);
    applyThemeTokenPreview(null);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    return { ok: true, tokens: readThemeTokens() };
  }
  if (command === "themes.preview") {
    const tokens = safeThemeTokens(payload.tokens);
    if (!tokens) throw new Error("Theme tokens are invalid.");
    applyThemeTokenPreview(tokens);
    return { ok: true, tokens, message: "Preview updated. Apply to keep these colors." };
  }
  if (command === "themes.apply") {
    if (!isMistyThemeId(payload.preset)) throw new Error("Unsupported theme preset.");
    const tokens = safeThemeTokens(payload.tokens);
    if (!tokens) throw new Error("Theme tokens are invalid.");
    store.setThemeMode(themeBaseMode(payload.preset));
    store.setThemeId(payload.preset);
    store.setCustomTokens(tokens);
    applyThemeTokenPreview(tokens);
    return { ok: true, tokens, message: "Theme saved and applied across Misty." };
  }
  if (command === "themes.revert") {
    const current = useAppThemeStore.getState();
    const root = document.documentElement;
    root.dataset.theme = current.resolvedTheme; root.dataset.mistyTheme = current.themeId;
    root.style.colorScheme = current.resolvedTheme;
    applyThemeTokenPreview(current.customTokens);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    return { ok: true, tokens: current.customTokens ?? readThemeTokens(), message: "Reverted to the saved theme." };
  }
  throw new Error("Theme command is not allowlisted.");
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
