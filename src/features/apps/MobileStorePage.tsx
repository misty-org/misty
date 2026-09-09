import { useMemo, useRef, useState } from "react";
import { OfficialAppDetails } from "./OfficialAppDetails";
import { discoverAppAction, discoverAppName } from "./appDetailsModel";
import { OfficialAppIcon } from "./OfficialAppIcon";
import { useAppsStore } from "./useAppsStore";

export function MobileStorePage() {
  const catalog = useAppsStore((state) => state.catalog);
  const installations = useAppsStore((state) => state.installations);
  const actionAppId = useAppsStore((state) => state.actionAppId);
  const error = useAppsStore((state) => state.error);
  const install = useAppsStore((state) => state.install);
  const uninstall = useAppsStore((state) => state.uninstall);
  const [selectedId, setSelectedId] = useState("");
  const returnFocus = useRef<HTMLElement | null>(null);
  const selected = catalog.find((app) => app.id === selectedId);
  const byId = useMemo(
    () => new Map(installations.map((item) => [item.app_id, item])),
    [installations],
  );
  return (
    <div className="misty-transient-scrollbar h-full overflow-y-auto bg-charcoal-bg">
      <div className="mx-auto w-full max-w-2xl px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-5 sm:px-6">
        <p className="mb-4 text-sm text-cream-muted">Official apps from Misty.</p>
        {error && !selected && (
          <p role="alert" className="discover-error">
            {error}
          </p>
        )}
        <ul className="divide-y divide-charcoal-border" aria-label="Official apps">
          {catalog.map((app) => {
            const action = discoverAppAction(app, byId.get(app.id), true);
            return (
              <li key={app.id} className="flex min-h-[76px] items-center gap-3 py-3">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  aria-label={`View ${discoverAppName(app)} details`}
                  onClick={(event) => {
                    returnFocus.current = event.currentTarget;
                    setSelectedId(app.id);
                  }}
                >
                  <OfficialAppIcon appId={app.id} size={40} />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-cream-bright">
                      {discoverAppName(app)}
                    </span>
                    <span className="mt-1 block text-xs text-cream-muted">{app.description}</span>
                  </span>
                </button>
                <button
                  type="button"
                  className="discover-action"
                  disabled={!!actionAppId || action === "Unavailable"}
                  aria-label={`${action} ${discoverAppName(app)}`}
                  onClick={(event) => {
                    returnFocus.current = event.currentTarget;
                    setSelectedId(app.id);
                  }}
                >
                  {action}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <OfficialAppDetails
        app={selected}
        installation={byId.get(selectedId)}
        actionAppId={actionAppId}
        mobile
        error={error}
        onClose={() => setSelectedId("")}
        onRestoreFocus={() => returnFocus.current?.focus()}
        onInstall={install}
        onRemove={(app) => uninstall(app.id)}
      />
    </div>
  );
}
