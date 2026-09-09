import { ArrowDownToLine, X } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { officialAppNeedsReview } from "@/features/apps/appInstallationStatus";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { check } from "@tauri-apps/plugin-updater";
import { useAppsStore } from "@/features/apps/useAppsStore";
import { settingsBoolean, useSettingsStore } from "@/features/settings";
import { hasTauriInternals } from "@/shared/platform/tauri";

/** Checks only. Downloads and installation always follow an explicit user action. */
export function UpdateNotices({ accountId }: { accountId: string }) {
  const navigate = useNavigate();
  const [hostVersion, setHostVersion] = useState("");
  const [notice, setNotice] = useState("");
  const [dismissed, setDismissed] = useState("");
  const catalog = useAppsStore((s) => s.catalog);
  const installations = useAppsStore((s) => s.installations);
  const enabled = useSettingsStore((s) =>
    settingsBoolean(s.settings?.document ?? {}, "general", "auto_update_enabled", true),
  );
  const updates = catalog.filter((app) =>
    officialAppNeedsReview(
      app,
      installations.find((i) => i.app_id === app.id),
    ),
  );
  const key = JSON.stringify([
    accountId,
    hostVersion,
    updates.map((a) => [a.id, a.version, a.permission_version]),
    notice,
  ]);
  useEffect(() => {
    const show = (event: Event) => {
      setNotice(String((event as CustomEvent).detail));
      setDismissed("");
    };
    window.addEventListener("misty:app-update-notice", show);
    return () => window.removeEventListener("misty:app-update-notice", show);
  }, []);
  useEffect(() => {
    if (!accountId || !enabled || !hasTauriInternals()) return;
    let closed = false,
      checking = false,
      last = 0;
    const refresh = async () => {
      if (closed || checking || Date.now() - last < 5 * 60_000) return;
      checking = true;
      last = Date.now();
      try {
        await useAppsStore.getState().load(accountId, true);
        if (closed) return;
        const update = await check({ timeout: 30_000 });
        try {
          if (!closed) setHostVersion(update?.version ?? "");
        } finally {
          await update?.close();
        }
      } catch {
        /* Manual checking in Settings exposes connection errors. */
      } finally {
        checking = false;
      }
    };
    const run = () => {
      void refresh();
    };
    run();
    const timer = window.setInterval(run, 30 * 60_000);
    window.addEventListener("focus", run);
    return () => {
      closed = true;
      clearInterval(timer);
      window.removeEventListener("focus", run);
    };
  }, [accountId, enabled]);
  if ((!hostVersion && !updates.length && !notice) || key === dismissed) return null;
  const title =
    notice ||
    (hostVersion
      ? `Misty ${hostVersion} is available`
      : updates.length === 1
        ? `${updates[0].name} update available`
        : `${updates.length} app updates available`);
  const description = hostVersion
    ? "Review the release in Settings."
    : updates.length === 1
      ? `Version ${updates[0]?.version}`
      : updates.map((app) => app.name).join(", ");
  return (
    <aside
      aria-label="Update notification"
      className="fixed bottom-4 right-4 z-50 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-charcoal-border bg-charcoal-card p-3 text-cream"
    >
      <div className="flex items-start gap-3">
        <ArrowDownToLine aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-cream-muted" />
        <div role="status" aria-live="polite" aria-atomic="true" className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-5">{title}</p>
          {!notice && (
            <p className="mt-1 break-words text-xs leading-4 text-cream-muted">{description}</p>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="-mr-1 -mt-1 text-cream-muted"
          aria-label="Dismiss update notification"
          onClick={() => {
            setDismissed(key);
            setNotice("");
          }}
        >
          <X aria-hidden="true" className="size-4" />
        </Button>
      </div>
      {!notice && (
        <div className="mt-3 flex justify-end">
          <Button
            type="button"
            size="sm"
            className="text-xs"
            onClick={() => {
              setDismissed(key);
              if (hostVersion)
                window.dispatchEvent(
                  new CustomEvent("misty:open-settings", { detail: { section: "updates" } }),
                );
              else
                navigate(
                  updates.length === 1
                    ? `/discover?app=${encodeURIComponent(updates[0].id)}`
                    : "/discover?section=installed",
                );
            }}
          >
            {hostVersion ? "View release" : updates.length === 1 ? "Review update" : "View updates"}
          </Button>
        </div>
      )}
    </aside>
  );
}
