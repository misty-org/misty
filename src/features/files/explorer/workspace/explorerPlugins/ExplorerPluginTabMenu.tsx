import { extensionAppRoute } from "@/features/extensions";
import { useWorkspaceStore, workspaceSurfaceFromRoute } from "@/features/workspace";
import type { PluginCommandEntry, PluginPanelEntry } from "@/native/contracts";
import { Button, Input, Popover, PopoverContent, PopoverTrigger } from "@/shared/ui";
import { Puzzle } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { explorerTrayStyles, pluginTabMenuStyles } from "../ExplorerDesktopPluginStyles";
import { cx } from "../ExplorerDesktopShared";
import { PluginIcon } from "./PluginPanelElementView";
import { filterPluginMenuItems, pluginMenuItems, pluginMenuSubtitle } from "./pluginMenu";

/** Files only hosts the launcher. App content opens in a normal workspace tab. */
export function ExplorerPluginTabMenu(props: {
  commands: PluginCommandEntry[];
  panels: PluginPanelEntry[];
  selectedPath: string;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const menuRef = useRef<HTMLDivElement | null>(null);
  const apps = useMemo(
    () => pluginMenuItems(props.panels, props.commands, props.selectedPath),
    [props.commands, props.panels, props.selectedPath],
  );
  const visibleApps = useMemo(() => filterPluginMenuItems(apps, query), [apps, query]);

  const openApp = (pluginId: string, pluginName: string) => {
    const route = extensionAppRoute(pluginId, {
      title: pluginName,
      selectedPaths: props.selectedPath ? [props.selectedPath] : [],
    });
    const surface = workspaceSurfaceFromRoute(route);
    if (!surface) return;
    const tab = useWorkspaceStore.getState().openSurface(surface);
    setOpen(false);
    navigate(tab.route);
  };

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!("ArrowDown ArrowUp Home End".split(" ") as string[]).includes(event.key)) return;
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    ).filter((item) => !item.hasAttribute("disabled") && item.offsetParent !== null);
    if (!items.length) return;
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
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          className={cx(explorerTrayStyles.trigger, open && explorerTrayStyles.triggerActive)}
          type="button"
          title="Apps"
          aria-label="Apps"
        >
          <Puzzle size={16} />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        ref={menuRef}
        align="end"
        sideOffset={7}
        collisionPadding={12}
        className={cx(
          pluginTabMenuStyles.menu,
          "max-h-[min(24rem,calc(100dvh-2rem))] w-[min(360px,calc(100vw-24px))]",
        )}
        role="menu"
        aria-label="Apps"
        onKeyDown={handleMenuKeyDown}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          window.requestAnimationFrame(() => {
            menuRef.current?.querySelector<HTMLElement>("[data-app-launcher-initial]")?.focus();
          });
        }}
      >
        <header className={pluginTabMenuStyles.header}>
          <span className={pluginTabMenuStyles.headerTitle}>
            <Puzzle size={16} />
            <strong>Apps</strong>
          </span>
          <span className={pluginTabMenuStyles.headerMeta}>{apps.length} available</span>
        </header>
        <label className={pluginTabMenuStyles.searchLabel}>
          <span className="sr-only">Search apps</span>
          <Input
            className={pluginTabMenuStyles.searchInput}
            data-app-launcher-initial
            value={query}
            placeholder="Search apps…"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        {visibleApps.length ? (
          <div className={pluginTabMenuStyles.sections}>
            {visibleApps.map((app) => (
              <Button
                key={app.pluginId}
                type="button"
                className={cx(
                  pluginTabMenuStyles.item,
                  app.usable && pluginTabMenuStyles.itemUsable,
                )}
                disabled={!app.panels.length}
                role="menuitem"
                onClick={() => openApp(app.pluginId, app.pluginName)}
              >
                <PluginIcon
                  pluginId={app.pluginId}
                  pluginName={app.pluginName}
                  fallback={app.kind}
                  size={16}
                />
                <span className={pluginTabMenuStyles.itemText}>
                  <strong>{app.pluginName}</strong>
                  <small>{pluginMenuSubtitle(app)}</small>
                </span>
                <span className={pluginTabMenuStyles.areaPill}>Tab</span>
              </Button>
            ))}
          </div>
        ) : (
          <div className={pluginTabMenuStyles.empty}>
            <Puzzle size={20} />
            <span>{apps.length ? "No apps match this search." : "No installed apps found."}</span>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
