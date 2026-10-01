import { ArrowDownToLine, X } from "lucide-react";
import { Button, IconButton } from "@/shared/ui";
import { useEffect, useState } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { settingsBoolean, useSettingsStore } from "@/features/settings";
import { hasTauriInternals } from "@/shared/platform/tauri";

/** Checks only. Downloads and installation always follow an explicit user action. */
const minCheckIntervalMs = 6 * 60 * 60_000;

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
      found = false,
      last = 0;
    // Background checks are a slow fallback: one at start, then at most one per
    // 6 hours, jittered, and none once an update is found. Settings still
    // checks on demand.
    const refresh = async () => {
      if (closed || checking || found || Date.now() - last < minCheckIntervalMs) return;
      checking = true;
      last = Date.now();
      try {
        const update = await check({ timeout: 30_000 });
        found = Boolean(update?.version);
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
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (delay: number) => {
      timer = setTimeout(() => {
        run();
        schedule(minCheckIntervalMs * (0.75 + Math.random() * 0.5));
      }, delay);
    };
    run();
    schedule(minCheckIntervalMs * (0.75 + Math.random() * 0.5));
    window.addEventListener("focus", run);
    return () => {
      closed = true;
      clearTimeout(timer);
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
        <IconButton
          label="Dismiss update notification"
          className="-mr-1 -mt-1"
          onClick={() => {
            setDismissed(key);
            setNotice("");
          }}
        >
          <X aria-hidden="true" className="size-4" />
        </IconButton>
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
