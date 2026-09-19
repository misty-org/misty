import { WorkspaceAppIcon } from "@/features/workspace/WorkspaceAppIcon";
import { routes } from "@/features/app-shell";
import {
  navigatorAppIdForOfficialApp,
  useAppsStore,
  usePinnedNavigatorAppIds,
} from "@/features/apps";
import { Input, Popover, PopoverContent, PopoverTrigger, cn } from "@/shared/ui";
import { Check, Compass, Plus, Search, LayoutGrid } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { isGlobalNavigatorApp } from "./navigatorAppPlacement";
import {
  navigatorFocusRingClass,
  navigatorHierarchyIslandClass,
  navigatorHierarchyActionClass,
  navigatorIslandIdentityLayoutClass,
} from "./styles";

export function NavigatorAppsSection(props: { accountId: string; children: ReactNode }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ready = useAppsStore((state) => state.ready);
  const loading = useAppsStore((state) => state.loading);
  const error = useAppsStore((state) => state.error);
  const catalog = useAppsStore((state) => state.catalog);
  const installations = useAppsStore((state) => state.installations);
  const actionAppId = useAppsStore((state) => state.actionAppId);
  const setPinnedApp = useAppsStore((state) => state.setPinned);
  const selectedAppIds = usePinnedNavigatorAppIds().filter((id) => !isGlobalNavigatorApp(id));
  const normalizedQuery = query.trim().toLowerCase();
  const visibleApps = useMemo(
    () =>
      installations
        .filter(
          (installation) =>
            installation.state === "installed" && !isGlobalNavigatorApp(installation.app_id),
        )
        .flatMap((installation) => {
          const app = catalog.find((candidate) => candidate.id === installation.app_id);
          const navigatorId = navigatorAppIdForOfficialApp(installation.app_id);
          return app && navigatorId ? [{ app, installation, navigatorId }] : [];
        })
        .filter(({ app, navigatorId }) => {
          if (!normalizedQuery) return true;
          return `${app.name} ${navigatorId === "library" ? "Storage" : ""} ${app.description}`
            .toLowerCase()
            .includes(normalizedQuery);
        }),
    [catalog, installations, normalizedQuery],
  );

  return (
    <div
      className="grid min-w-0 gap-1"
      data-tour-target="apps-section"
      role="group"
      aria-label="Apps"
    >
      <div
        className={cn(navigatorHierarchyIslandClass, "w-full")}
        role="group"
        aria-label="Apps controls"
      >
        <h2 className={cn(navigatorIslandIdentityLayoutClass, "flex-1 text-sm font-semibold tracking-[-0.015em] text-cream")}>
          <span className="grid size-6 shrink-0 place-items-center">
            <LayoutGrid className="size-5" strokeWidth={1.75} aria-hidden="true" />
          </span>
          <span>Apps</span>
        </h2>

        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={navigatorHierarchyActionClass}
              aria-label="Add app"
              title="Add app"
              data-tour-target="nav-add-app-button"
            >
              <Plus className="size-4" size={16} strokeWidth={2} aria-hidden="true" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-[300px] overflow-hidden p-0"
            side="right"
            sideOffset={12}
          >
            <div className="border-b border-charcoal-border p-2">
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

            <div className="misty-transient-scrollbar max-h-[360px] overflow-y-auto p-1">
              {visibleApps.length ? (
                visibleApps.map(({ app, installation, navigatorId }) => {
                  const selected = selectedAppIds.some((id) => id === navigatorId);
                  return (
                    <button
                      key={app.id}
                      type="button"
                      className={cn(
                        "group/app-option flex min-h-9 w-full items-center gap-2 text-sm text-cream",
                        "rounded-md px-2 py-1 text-left outline-none transition-colors disabled:opacity-50",
                      )}
                      role="checkbox"
                      aria-checked={selected}
                      disabled={Boolean(actionAppId)}
                      onClick={() => void setPinnedApp(app.id, !installation.pinned)}
                    >
                      <WorkspaceAppIcon
                        appId={navigatorId}
                        size="picker"
                        className="[&_svg]:!size-[18px]"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-cream">
                          {navigatorId === "library"
                            ? "Storage"
                            : app.name === "Chat"
                              ? "Social"
                              : app.name}
                        </span>
                      </span>
                      <span
                        aria-hidden="true"
                        className={cn(
                          "grid size-4 shrink-0 place-items-center rounded-[4px] border transition-colors",
                          "group-focus-visible/app-option:ring-2 group-focus-visible/app-option:ring-cream-muted group-focus-visible/app-option:ring-offset-2 group-focus-visible/app-option:ring-offset-charcoal-card",
                          selected
                            ? "border-cream-bright bg-cream-bright text-charcoal-bg group-hover/app-option:border-cream group-hover/app-option:bg-cream"
                            : "border-cream-muted/60 bg-transparent group-hover/app-option:border-cream-bright group-hover/app-option:bg-cream/10",
                        )}
                      >
                        {selected && <Check className="size-3" strokeWidth={3} />}
                      </span>
                    </button>
                  );
                })
              ) : (
                <p className="px-3 py-6 text-center text-xs text-cream-muted">No apps found.</p>
              )}
            </div>

            <div className="border-t border-charcoal-border p-1.5">
              <Link
                to={routes.discover}
                data-tour-target="nav-browse-apps"
                className={cn(
                  "flex h-9 items-center gap-2 rounded-md px-2.5 text-sm text-cream-muted no-underline",
                  "outline-none transition-colors hover:bg-charcoal-hover hover:text-cream-bright",
                  navigatorFocusRingClass,
                )}
                onClick={() => {
                  setPickerOpen(false);
                }}
              >
                <Compass size={14} aria-hidden="true" />
                <span>Browse more apps</span>
              </Link>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <div className="grid gap-1">
        {selectedAppIds.length ? (
          props.children
        ) : !ready ? (
          <button
            type="button"
            disabled={loading}
            className="mx-2.5 rounded-md px-2.5 py-2 text-left text-xs text-cream-muted hover:text-cream"
            onClick={() => void useAppsStore.getState().load(props.accountId, true)}
          >
            {loading ? "Loading apps…" : error ? "Apps unavailable. Try again" : "Loading apps…"}
          </button>
        ) : (
          <button
            type="button"
            className="mx-2.5 rounded-md px-2.5 py-2 text-left text-xs text-cream-muted hover:text-cream"
            onClick={() => setPickerOpen(true)}
          >
            No apps added. Choose an app
          </button>
        )}
      </div>
    </div>
  );
}
