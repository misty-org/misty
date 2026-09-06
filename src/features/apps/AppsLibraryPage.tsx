import { useAuth } from "@/features/auth";
import { preferredDefaultSpace, spaceNavigationName, useSpacesStore } from "@/features/spaces/core";
import { isNativeMobileBuild } from "@/shared/platform/buildTarget";
import { Button, Separator, cn } from "@/shared/ui";
import { ChevronRight, Pin, Settings, Store, UserRound } from "lucide-react";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { officialAppRoute } from "./appRoute";
import { OfficialAppIcon } from "./OfficialAppIcon";
import { useAppsStore } from "./useAppsStore";

export function AppsLibraryPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const spaces = useSpacesStore((state) => state.spaces);
  const catalog = useAppsStore((state) => state.catalog);
  const installations = useAppsStore((state) => state.installations);
  const actionAppId = useAppsStore((state) => state.actionAppId);
  const setPinned = useAppsStore((state) => state.setPinned);
  const activeSpace = preferredDefaultSpace(spaces);
  const installed = useMemo(
    () =>
      installations
        .filter((item) => item.state === "installed")
        .sort((left, right) => left.pin_rank - right.pin_rank)
        .flatMap((installation) => {
          const app = catalog.find((candidate) => candidate.id === installation.app_id);
          return app ? [{ app, installation }] : [];
        }),
    [catalog, installations],
  );
  const usable = installed.filter(
    ({ app }) => !isNativeMobileBuild || app.mobile.runtime !== "unsupported",
  );
  const desktopOnly = installed.filter(
    ({ app }) => isNativeMobileBuild && app.mobile.runtime === "unsupported",
  );

  return (
    <div className="misty-transient-scrollbar h-full overflow-y-auto bg-charcoal-bg">
      <div className="mx-auto w-full max-w-2xl px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-5 sm:px-6">
        {!isNativeMobileBuild ? (
          <header className="mb-5">
            <h1 className="text-xl font-semibold tracking-tight text-cream-bright">Apps</h1>
            <p className="mt-1 text-sm text-cream-muted">
              The tools installed for your Misty account.
            </p>
          </header>
        ) : null}

        <section
          aria-label="Installed apps"
          className="overflow-hidden rounded-lg border border-charcoal-border bg-charcoal-card/30"
        >
          {usable.length ? (
            usable.map(({ app, installation }, index) => (
              <div key={app.id}>
                {index ? <Separator /> : null}
                <div className="flex min-h-16 items-center gap-1 px-1.5 py-1">
                  <button
                    type="button"
                    className={cn(
                      "flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-md px-1.5",
                      "text-left transition-colors hover:bg-charcoal-hover active:bg-charcoal-active",
                    )}
                    onClick={() =>
                      navigate(officialAppRoute(app.id, activeSpace?.id, user?.id ?? ""))
                    }
                  >
                    <OfficialAppIcon appId={app.id} size={38} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-cream-bright">
                        {app.name}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-cream-muted">
                        {app.description}
                      </span>
                    </span>
                    <ChevronRight
                      className="shrink-0 text-cream-muted"
                      size={17}
                      aria-hidden="true"
                    />
                  </button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    disabled={Boolean(actionAppId)}
                    aria-label={`${installation.pinned ? "Unpin" : "Pin"} ${app.name}`}
                    title={`${installation.pinned ? "Remove" : "Add"} ${app.name} ${isNativeMobileBuild ? "from navigation" : "to the sidebar"}`}
                    onClick={() =>
                      void setPinned(app.id, !installation.pinned).catch(() => undefined)
                    }
                  >
                    <Pin
                      size={16}
                      className={
                        installation.pinned ? "fill-current text-cream" : "text-cream-muted"
                      }
                      aria-hidden="true"
                    />
                  </Button>
                </div>
              </div>
            ))
          ) : (
            <div className="px-5 py-10 text-center">
              <p className="text-sm font-medium text-cream">No apps installed</p>
              <p className="mt-1 text-xs leading-5 text-cream-muted">
                Add only what you need from Discover.
              </p>
            </div>
          )}
        </section>

        {desktopOnly.length ? (
          <section className="mt-6" aria-label="Desktop apps">
            <h2 className="mb-2 text-sm font-medium text-cream">Desktop apps</h2>
            <div className="overflow-hidden rounded-lg border border-charcoal-border bg-charcoal-card/20">
              {desktopOnly.map(({ app }, index) => (
                <div key={app.id}>
                  {index ? <Separator /> : null}
                  <button
                    type="button"
                    className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left active:bg-charcoal-active"
                    onClick={() => navigate(desktopHandoffRoute(app.id))}
                  >
                    <OfficialAppIcon appId={app.id} size={34} />
                    <span className="min-w-0 flex-1 truncate text-sm text-cream-muted">
                      {app.name}
                    </span>
                    <span className="text-xs text-cream-muted">Open on desktop</span>
                    <ChevronRight size={16} className="text-cream-muted" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {isNativeMobileBuild ? (
          <section className="mt-7 grid gap-2" aria-label="Account shortcuts">
            <p className="px-1 pt-1 text-xs font-medium text-cream-muted">Spaces</p>
            {spaces.map((space) => (
              <Button
                key={space.id}
                className="h-11 justify-between"
                variant={space.id === activeSpace?.id ? "secondary" : "outline"}
                onClick={() => navigate(`/spaces/${encodeURIComponent(space.id)}/home`)}
              >
                <span className="truncate">{spaceNavigationName(space)}</span>
                <ChevronRight size={16} aria-hidden="true" />
              </Button>
            ))}
            <Button
              className="h-11 justify-start"
              variant="outline"
              onClick={() => navigate("/discover")}
            >
              <Store size={17} aria-hidden="true" />
              Open Discover
            </Button>
            <Button
              className="h-11 justify-start"
              variant="ghost"
              onClick={() => navigate("/settings")}
            >
              <Settings size={17} aria-hidden="true" />
              Settings
            </Button>
            <Button
              className="h-11 justify-start"
              variant="ghost"
              onClick={() => navigate("/profile")}
            >
              <UserRound size={17} aria-hidden="true" />
              Account
            </Button>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function desktopHandoffRoute(appId: string): string {
  if (appId === "terminal") return "/terminal";
  return "/code";
}
