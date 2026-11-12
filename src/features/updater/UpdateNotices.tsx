import { Button, Notification } from "@/shared/ui";
import { useEffect, useState } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { settingsBoolean, useSettingsStore } from "@/features/settings";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { ReleaseNotesDialog } from "./ReleaseNotesDialog";

/** Checks only. Downloads and installation always follow an explicit user action. */
const minCheckIntervalMs = 6 * 60 * 60_000;

/** `accountScope` is the signed-in account, or `local` while nobody is signed in: updates
 * don't wait for an account. */
export function UpdateNotices({ accountScope }: { accountScope: string }) {
  const [hostVersion, setHostVersion] = useState("");
  const [notice, setNotice] = useState("");
  const [dismissed, setDismissed] = useState("");
  const enabled = useSettingsStore((s) =>
    settingsBoolean(s.settings?.document ?? {}, "general", "auto_update_enabled", true),
  );
  const key = JSON.stringify([accountScope, hostVersion, notice]);
  useEffect(() => {
    const show = (event: Event) => {
      setNotice(String((event as CustomEvent).detail));
      setDismissed("");
    };
    window.addEventListener("misty:workspace-notice", show);
    return () => window.removeEventListener("misty:workspace-notice", show);
  }, []);
  useEffect(() => {
    if (!accountScope || !enabled || !hasTauriInternals()) return;
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
  }, [accountScope, enabled]);
  const showNotice = (hostVersion || notice) && key !== dismissed;
  return (
    <>
      {/* Always in the same place, so a notice coming or going never shows the notes again. */}
      <ReleaseNotesDialog />
      {showNotice ? (
        <Notification
          key={key}
          title={notice ? undefined : `Misty ${hostVersion} is available`}
          onDismiss={() => {
            setDismissed(key);
            setNotice("");
          }}
        >
          {notice || (
            <Button
              type="button"
              variant="link"
              size="none"
              onClick={() => {
                setDismissed(key);
                window.dispatchEvent(
                  new CustomEvent("misty:open-settings", { detail: { section: "updates" } }),
                );
              }}
            >
              View release
            </Button>
          )}
        </Notification>
      ) : null}
    </>
  );
}
