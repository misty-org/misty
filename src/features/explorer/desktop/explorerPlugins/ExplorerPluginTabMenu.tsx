import type { PluginMenuItem } from "@/models/types/features/explorer/desktop/ExplorerDesktopPlugins";
import { Input } from "@/ui";
import { Button } from "@/ui";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui";
import { ArrowLeft, Puzzle, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useLocation, useNavigate } from "react-router-dom";
import type { PluginCommandEntry, PluginPanelEntry } from "@/models/interfaces/services/misty-api";
import { cx } from "../ExplorerDesktopShared";
import {
  explorerTrayStyles,
  pluginTabHostStyles,
  pluginTabMenuStyles,
} from "../ExplorerDesktopPluginStyles";
import { ExplorerPluginTabContent } from "./ExplorerPluginTabContent";
import { PluginIcon } from "./PluginPanelElementView";
import {
  extensionAreaLabel,
  filterPluginMenuItems,
  pluginMenuItems,
  pluginMenuSubtitle,
  pluginPanelUsableInCurrentArea,
} from "./pluginMenu";
import { ExplorerPluginPanelHost } from "./pluginPanelHosts";

export function ExplorerPluginTabMenu(props: {
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
  const menuRef = useRef<HTMLDivElement | null>(null);
  const plugins = useMemo(
    () => pluginMenuItems(props.panels, props.commands, props.selectedPath),
    [props.commands, props.panels, props.selectedPath],
  );
  const visiblePlugins = useMemo(() => filterPluginMenuItems(plugins, query), [plugins, query]);
  const highlightedCount = plugins.filter((plugin) => plugin.usable).length;
  const selectedPlugin = plugins.find((plugin) => plugin.pluginId === selectedPluginId) ?? null;
  const selectedPath = requestedSelectedPath || props.selectedPath;

  const closePopup = useCallback(() => {
    setOpen(false);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const pluginId = params.get("extension");
    if (!pluginId) return;
    setSelectedPluginId(pluginId);
    setVisitedPluginIds((current) =>
      current.includes(pluginId) ? current : [...current, pluginId],
    );
    setRequestedSelectedPath(params.get("selected") ?? "");
    setOpen(true);
    params.delete("extension");
    params.delete("selected");
    navigate(
      { pathname: location.pathname, search: params.toString() ? `?${params}` : "" },
      { replace: true },
    );
  }, [location.pathname, location.search, navigate]);

  const selectPlugin = useCallback((plugin: PluginMenuItem) => {
    setSelectedPluginId(plugin.pluginId);
    setVisitedPluginIds((current) =>
      current.includes(plugin.pluginId) ? current : [...current, plugin.pluginId],
    );
  }, []);

  const handleMenuKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!(["ArrowDown", "ArrowUp", "Home", "End"] as string[]).includes(event.key)) return;
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    ).filter((item) => !item.hasAttribute("disabled") && item.offsetParent !== null);
    if (items.length === 0) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : event.key === "ArrowUp"
            ? current <= 0
              ? items.length - 1
              : current - 1
            : (current + 1) % items.length;
    items[next]?.focus();
  }, []);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setRequestedSelectedPath("");
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          className={cx(explorerTrayStyles.trigger, open && explorerTrayStyles.triggerActive)}
          type="button"
          title="Extensions"
        >
          <Puzzle size={16} />
        </Button>
      </PopoverTrigger>
      {open || visitedPluginIds.length > 0 ? (
        <PopoverContent
          ref={menuRef}
          forceMount
          align="end"
          sideOffset={7}
          collisionPadding={12}
          className={cx(
            pluginTabMenuStyles.menu,
            "max-h-[var(--radix-popover-content-available-height)]",
          )}
          style={{
            width: `min(${selectedPluginId ? 600 : 360}px, calc(100vw - 24px))`,
            display: open ? undefined : "none",
          }}
          role={selectedPlugin ? "dialog" : "menu"}
          aria-label={selectedPlugin ? `${selectedPlugin.pluginName} extension` : "Extensions"}
          aria-hidden={!open}
          onKeyDown={handleMenuKeyDown}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            window.requestAnimationFrame(() => {
              menuRef.current
                ?.querySelector<HTMLElement>("[data-extension-popup-initial]")
                ?.focus();
            });
          }}
        >
          <header className={pluginTabMenuStyles.header}>
            <span className={pluginTabMenuStyles.headerTitle}>
              {selectedPlugin ? (
                <Button
                  data-extension-popup-initial
                  className={pluginTabMenuStyles.iconButton}
                  type="button"
                  title="Back to extensions"
                  onClick={() => setSelectedPluginId(null)}
                >
                  <ArrowLeft size={16} />
                </Button>
              ) : (
                <Puzzle size={16} />
              )}
              {selectedPlugin ? (
                <PluginIcon
                  pluginId={selectedPlugin.pluginId}
                  pluginName={selectedPlugin.pluginName}
                  fallback={selectedPlugin.kind}
                  size={18}
                />
              ) : null}
              <strong>{selectedPlugin?.pluginName ?? "Extensions"}</strong>
            </span>
            {selectedPlugin ? (
              <Button
                className={pluginTabMenuStyles.iconButton}
                type="button"
                title="Close extensions"
                onClick={() => closePopup()}
              >
                <X size={16} />
              </Button>
            ) : (
              <span className={pluginTabMenuStyles.headerMeta}>{highlightedCount} usable</span>
            )}
          </header>
          {!selectedPlugin ? (
            <label className={pluginTabMenuStyles.searchLabel}>
              <span className="sr-only">Search extensions</span>
              <Input
                className={pluginTabMenuStyles.searchInput}
                data-extension-popup-initial
                value={query}
                placeholder="Search extensions..."
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          ) : null}
          {!selectedPlugin && plugins.length > 0 ? (
            <div className={pluginTabMenuStyles.sections}>
              {visiblePlugins.map((plugin) => (
                <Button
                  key={plugin.pluginId}
                  type="button"
                  className={cx(
                    pluginTabMenuStyles.item,
                    plugin.usable && pluginTabMenuStyles.itemUsable,
                  )}
                  role="menuitem"
                  onClick={() => selectPlugin(plugin)}
                >
                  <PluginIcon
                    pluginId={plugin.pluginId}
                    pluginName={plugin.pluginName}
                    fallback={plugin.kind}
                    size={16}
                  />
                  <span className={pluginTabMenuStyles.itemText}>
                    <strong>{plugin.pluginName}</strong>
                    <small>{pluginMenuSubtitle(plugin)}</small>
                  </span>
                  <span
                    className={cx(
                      pluginTabMenuStyles.areaPill,
                      plugin.usable && pluginTabMenuStyles.areaPillUsable,
                    )}
                  >
                    {plugin.usable ? "Files" : extensionAreaLabel(plugin.primaryArea)}
                  </span>
                </Button>
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
            const panel =
              plugin.panels.find(pluginPanelUsableInCurrentArea) ?? plugin.panels[0] ?? null;
            return (
              <div
                key={pluginId}
                className={pluginTabMenuStyles.detail}
                hidden={selectedPluginId !== pluginId}
              >
                <div
                  className={pluginTabMenuStyles.selection}
                  title={selectedPath || "No file selected"}
                >
                  <span>Selected file</span>
                  <strong>{selectedPath || "No file selected"}</strong>
                </div>
                {panel ? (
                  <ExplorerPluginPanelHost panel={panel} selectedPath={selectedPath} />
                ) : null}
                {plugin.commands.length > 0 ? (
                  <ExplorerPluginTabContent
                    tab={{ kind: "commands", pluginId: plugin.pluginId, panelId: "", selectedPath }}
                    commands={plugin.commands}
                    panels={[]}
                  />
                ) : null}
                {!panel && plugin.commands.length === 0 ? (
                  <div className={pluginTabHostStyles.empty}>
                    <Puzzle size={24} />
                    <h3>Extension unavailable</h3>
                    <p>No supported panel or commands were found.</p>
                  </div>
                ) : null}
              </div>
            );
          })}
        </PopoverContent>
      ) : null}
    </Popover>
  );
}
