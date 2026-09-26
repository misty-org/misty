import { CircleAlert, CircleCheck, LoaderCircle } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { usePageRestoreStore } from "./store";

/** Per-tab result of restoring pages after a device switch. */
export function RestoreStatusList() {
  const tabs = Object.values(usePageRestoreStore((state) => state.tabs));
  if (!tabs.length) return null;
  return (
    <section aria-label="Restored pages" className="border-t border-charcoal-border py-3">
      <h2 className="pb-2 text-sm font-medium">Restoring pages</h2>
      <ul className="space-y-2 text-sm">
        {tabs.map((tab) => (
          <li key={tab.tabId} className="flex items-center gap-2">
            {tab.status === "restoring" ? (
              <LoaderCircle
                aria-hidden
                className="size-4 shrink-0 animate-spin motion-reduce:animate-none text-cream-muted"
              />
            ) : tab.status === "restored" ? (
              <CircleCheck aria-hidden className="size-4 shrink-0 text-status-green" />
            ) : (
              <CircleAlert aria-hidden className="size-4 shrink-0 text-cream-muted" />
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate" title={tab.title}>
                {tab.title || "Untitled page"}
              </div>
              <div className="text-xs text-cream-muted">
                {tab.status === "restoring"
                  ? "Restoring…"
                  : tab.status === "restored"
                    ? tab.secrets
                      ? `Restored · ${tab.secrets} private field${tab.secrets === 1 ? "" : "s"} to fill again`
                      : "Restored"
                    : tab.status === "failed"
                      ? "Couldn't restore this page"
                      : `Partly restored · ${tab.remaining} field${tab.remaining === 1 ? "" : "s"} left`}
              </div>
            </div>
            {(tab.status === "partial" || tab.status === "failed") && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  // Loaded on demand: the restorer pulls in the workspace store.
                  void import("./restorer").then(({ finishRestoring }) =>
                    finishRestoring(tab.tabId),
                  )
                }
              >
                Finish restoring
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
