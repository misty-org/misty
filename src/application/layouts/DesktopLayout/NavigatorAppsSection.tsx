import { routes } from "@/features/app-shell";
import {
  OfficialAppIcon,
  navigatorAppIdForOfficialApp,
  useAppsStore,
  usePinnedNavigatorAppIds,
} from "@/features/apps";
import {
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  cn,
  navigationMenuActionClass,
} from "@/shared/ui";
import { Check, Plus, Search } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { navigatorFocusRingClass } from "./styles";

export function NavigatorAppsSection(props: { accountId: string; children: ReactNode }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const catalog = useAppsStore((state) => state.catalog);
  const installations = useAppsStore((state) => state.installations);
  const actionAppId = useAppsStore((state) => state.actionAppId);
  const setPinnedApp = useAppsStore((state) => state.setPinned);
  const selectedAppIds = usePinnedNavigatorAppIds();
  const normalizedQuery = query.trim().toLowerCase();
  const visibleApps = useMemo(
    () =>
      installations
        .filter((installation) => installation.state === "installed")
        .flatMap((installation) => {
          const app = catalog.find((candidate) => candidate.id === installation.app_id);
          const navigatorId = navigatorAppIdForOfficialApp(installation.app_id);
          return app && navigatorId ? [{ app, installation, navigatorId }] : [];
        })
        .filter(({ app }) => {
          if (!normalizedQuery) return true;
          return `${app.name} ${app.description}`.toLowerCase().includes(normalizedQuery);
        }),
    [catalog, installations, normalizedQuery],
  );

  return (
    <div
      className="grid min-w-0 gap-0.5"
      data-tour-target="apps-section"
      role="group"
      aria-label="Apps"
    >
      <div
        className="sticky top-0 z-10 flex w-full min-w-0 items-center bg-charcoal-workspace"
        role="group"
        aria-label="Apps controls"
      >
        <h2 className="flex h-8 min-w-0 flex-1 items-center px-2.5 text-[13px] font-medium text-cream-muted">
          Apps
        </h2>

        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={navigationMenuActionClass}
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
              {visibleApps.length ? (
                visibleApps.map(({ app, installation, navigatorId }) => {
                  const selected = selectedAppIds.includes(navigatorId);
                  return (
                    <button
                      key={app.id}
                      type="button"
                      className={cn(
                        "grid min-h-12 w-full grid-cols-[36px_minmax(0,1fr)_18px] items-center gap-3",
                        "rounded-md px-2.5 py-1.5 text-left outline-none transition-colors",
                        "hover:bg-charcoal-hover focus-visible:bg-charcoal-hover",
                      )}
                      aria-pressed={selected}
                      disabled={Boolean(actionAppId)}
                      onClick={() => void setPinnedApp(app.id, !installation.pinned)}
                    >
                      <OfficialAppIcon appId={app.id} size={36} />
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-cream">
                          {app.name === "Chat" ? "Social" : app.name}
                        </span>
                        <span className="block truncate text-[11px] text-cream-muted">
                          {app.description}
                        </span>
                      </span>
                      {selected ? (
                        <Check
                          className="text-cream-bright"
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
                to={routes.discover}
                data-tour-target="nav-browse-apps"
                className={cn(
                  "flex h-9 items-center rounded-md px-2.5 text-sm text-cream-muted no-underline",
                  "outline-none transition-colors hover:bg-charcoal-hover hover:text-cream-bright",
                  navigatorFocusRingClass,
                )}
                onClick={() => {
                  setPickerOpen(false);
                }}
              >
                Browse apps
              </Link>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <div className="grid gap-1">
        {selectedAppIds.length ? (
          props.children
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
