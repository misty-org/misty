import { routes } from "@/features/app-shell";
import { extensionAppRoute, useInstalledApps } from "@/features/extensions";
import {
  NAVIGATOR_APP_DESCRIPTIONS,
  NAVIGATOR_APP_IDS,
  WORKSPACE_TOOLS_META,
  WorkspaceAppIcon,
  dockLeaves,
  navigatorAppsCollapsedForAccount,
  navigatorAppIdsForAccount,
  useNavigatorAppsStore,
  useWorkspaceStore,
  workspaceSurfaceFromRoute,
} from "@/features/workspace";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  cn,
  navigationDisclosureChevronClass,
  navigationDisclosureLabelClass,
} from "@/shared/ui";
import { Blocks, Check, ChevronRight, Plus, Search } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { navigatorFocusRingClass, navigatorRowClass } from "./styles";
import { useNavigatorDisclosureState } from "./useNavigatorDisclosureState";

export function NavigatorAppsSection(props: { accountId: string; children: ReactNode }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const installedApps = useInstalledApps();
  const activeAppId = useWorkspaceStore((state) => {
    const activePane = dockLeaves(state.layout.root).find(
      (pane) => pane.id === state.layout.focusedPaneId,
    );
    const tab = activePane?.tabs.find((candidate) => candidate.id === activePane.activeTabId);
    return tab?.surfaceId === "extension" && tab.groupKey.startsWith("app:")
      ? tab.groupKey.slice(4)
      : undefined;
  });
  const collapsed = useNavigatorAppsStore((state) =>
    navigatorAppsCollapsedForAccount(state, props.accountId),
  );
  const selectedAppIds = useNavigatorAppsStore((state) =>
    navigatorAppIdsForAccount(state, props.accountId),
  );
  const setAppVisible = useNavigatorAppsStore((state) => state.setAppVisible);
  const setCollapsed = useNavigatorAppsStore((state) => state.setCollapsed);
  const [open, setOpen] = useNavigatorDisclosureState(props.accountId, "apps", !collapsed);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleAppIds = useMemo(
    () =>
      NAVIGATOR_APP_IDS.filter((id) => {
        if (!normalizedQuery) return true;
        const meta = WORKSPACE_TOOLS_META[id];
        return `${meta.label} ${NAVIGATOR_APP_DESCRIPTIONS[id]}`
          .toLowerCase()
          .includes(normalizedQuery);
      }),
    [normalizedQuery],
  );

  return (
    <Collapsible
      className="group/apps grid min-w-0 gap-0.5"
      onOpenChange={(nextOpen) => {
        setCollapsed(props.accountId, !nextOpen);
        setOpen(nextOpen);
      }}
      open={open}
      role="group"
      aria-label="Apps"
    >
      <div
        className="flex w-full min-w-0 items-center pl-2.5 pr-0"
        role="group"
        aria-label="Apps controls"
      >
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className={cn(
              navigationDisclosureLabelClass,
              "flex-1 rounded-md py-1 text-left",
              "text-[13px] font-semibold text-cream-bright outline-none",
              navigatorFocusRingClass,
            )}
            aria-label={open ? "Collapse Apps" : "Expand Apps"}
          >
            <span className="truncate">Apps</span>
            <ChevronRight
              className={cn(
                navigationDisclosureChevronClass,
                "transition-transform duration-150 motion-reduce:transition-none",
                open && "rotate-90",
              )}
              size={16}
              strokeWidth={2}
              aria-hidden="true"
              data-chevron-placement="inline"
            />
          </button>
        </CollapsibleTrigger>

        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                "misty-navigator-icon-target ml-auto grid size-7 shrink-0 place-items-center rounded-md",
                "text-cream-muted opacity-0 outline-none transition-[color,background-color,opacity]",
                "hover:bg-charcoal-card hover:text-cream-bright group-hover/apps:opacity-100",
                "focus-visible:opacity-100 group-focus-within/apps:opacity-100",
                "[@media(hover:none)]:opacity-100",
                navigatorFocusRingClass,
              )}
              aria-label="Add app"
              title="Add app"
            >
              <Plus className="!size-3.5" size={14} strokeWidth={2} aria-hidden="true" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-[300px] overflow-hidden p-0"
            side="right"
            sideOffset={8}
          >
            <div className="border-b border-charcoal-border p-2.5">
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-cream-muted"
                  size={14}
                  aria-hidden="true"
                />
                <Input
                  aria-label="Search apps"
                  autoFocus
                  className="h-8 pl-8 text-sm"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search apps…"
                  value={query}
                />
              </div>
            </div>

            <div className="misty-transient-scrollbar max-h-[360px] overflow-y-auto p-1.5">
              {visibleAppIds.length ? (
                visibleAppIds.map((id) => {
                  const app = WORKSPACE_TOOLS_META[id];
                  const selected = selectedAppIds.includes(id);
                  return (
                    <button
                      key={id}
                      type="button"
                      className={cn(
                        "grid min-h-11 w-full grid-cols-[20px_minmax(0,1fr)_18px] items-center gap-2.5",
                        "rounded-md px-2.5 py-1.5 text-left outline-none transition-colors",
                        "hover:bg-charcoal-hover focus-visible:bg-charcoal-hover",
                      )}
                      aria-pressed={selected}
                      onClick={() => setAppVisible(props.accountId, id, !selected)}
                    >
                      <WorkspaceAppIcon appId={id} size="picker" />
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-cream">{app.label}</span>
                        <span className="block truncate text-[11px] text-cream-muted">
                          {NAVIGATOR_APP_DESCRIPTIONS[id]}
                        </span>
                      </span>
                      {selected ? (
                        <Check
                          className="text-sage-fg"
                          size={16}
                          strokeWidth={2}
                          aria-hidden="true"
                        />
                      ) : null}
                    </button>
                  );
                })
              ) : (
                <p className="px-3 py-6 text-center text-xs text-cream-muted">No apps found.</p>
              )}
            </div>

            <div className="border-t border-charcoal-border p-1.5">
              <Link
                to={routes.store}
                className={cn(
                  "flex h-9 items-center rounded-md px-2.5 text-sm text-cream-muted no-underline",
                  "outline-none transition-colors hover:bg-charcoal-hover hover:text-cream-bright",
                  navigatorFocusRingClass,
                )}
                onClick={() => {
                  setPickerOpen(false);
                  const surface = workspaceSurfaceFromRoute(routes.store);
                  if (surface) useWorkspaceStore.getState().openSurface(surface);
                }}
              >
                Browse apps
              </Link>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <CollapsibleContent className="grid gap-1">
        {selectedAppIds.length || installedApps.length ? (
          <>
            {props.children}
            {installedApps.map((app) => {
              const path = extensionAppRoute(app.id, { title: app.name });
              const active = activeAppId === app.id;
              return (
                <Link
                  aria-current={active ? "page" : undefined}
                  aria-label={app.name}
                  className={navigatorRowClass(active)}
                  key={app.id}
                  onClick={() => {
                    const surface = workspaceSurfaceFromRoute(path);
                    if (surface) useWorkspaceStore.getState().openSurface(surface);
                  }}
                  to={path}
                >
                  <span className="grid size-7 shrink-0 place-items-center">
                    <Blocks aria-hidden="true" size={18} strokeWidth={1.8} />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{app.name}</span>
                </Link>
              );
            })}
          </>
        ) : (
          <button
            type="button"
            className="mx-2.5 rounded-md px-2.5 py-2 text-left text-xs text-cream-muted hover:text-cream"
            onClick={() => setPickerOpen(true)}
          >
            No apps added. Choose an app
          </button>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
