import { ArrowDownToLine, X } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { useEffect, useState } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { settingsBoolean, useSettingsStore } from "@/features/settings";
import { hasTauriInternals } from "@/shared/platform/tauri";

/** Checks only. Downloads and installation always follow an explicit user action. */
export function UpdateNotices({ accountId }: { accountId: string }) {
  const [hostVersion, setHostVersion] = useState("");
  const [notice, setNotice] = useState("");
  const [dismissed, setDismissed] = useState("");
  const enabled = useSettingsStore((s) =>
    settingsBoolean(s.settings?.document ?? {}, "general", "auto_update_enabled", true),
  );
  const key = JSON.stringify([accountId, hostVersion, notice]);
  useEffect(() => {
    const show = (event: Event) => {
      setNotice(String((event as CustomEvent).detail));
      setDismissed("");
    };
    window.addEventListener("misty:workspace-notice", show);
    return () => window.removeEventListener("misty:workspace-notice", show);
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
  if ((!hostVersion && !notice) || key === dismissed) return null;
  const title = notice || `Misty ${hostVersion} is available`;
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
            <p className="mt-1 break-words text-xs leading-4 text-cream-muted">
              Review the release in Settings.
            </p>
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
              window.dispatchEvent(
                new CustomEvent("misty:open-settings", { detail: { section: "updates" } }),
              );
            }}
          >
            View release
          </Button>
        </div>
      )}
    </aside>
  );
}
