import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { check } from "@tauri-apps/plugin-updater";
import { useAppsStore } from "@/features/apps/useAppsStore";
import { settingsBoolean, useSettingsStore } from "@/features/settings";
import { hasTauriInternals } from "@/shared/platform/tauri";

/** Checks only. Downloads and installation always follow an explicit user action. */
export function UpdateNotices({accountId}:{accountId:string}) {
  const navigate = useNavigate();
  const [hostVersion, setHostVersion] = useState("");
  const [notice, setNotice] = useState("");
  const [dismissed, setDismissed] = useState("");
  const catalog = useAppsStore(s => s.catalog);
  const installations = useAppsStore(s => s.installations);
  const enabled = useSettingsStore(s => settingsBoolean(s.settings?.document ?? {}, "general", "auto_update_enabled", true));
  const updates = catalog.filter(app => installations.some(i => i.app_id === app.id && i.state === "installed" && (i.installed_version !== app.version || i.permission_version !== app.permission_version)));
  const key = JSON.stringify([accountId, hostVersion, updates.map(a => [a.id,a.version,a.permission_version]), notice]);
  useEffect(() => {
    const show = (event: Event) => { setNotice(String((event as CustomEvent).detail)); setDismissed(""); };
    window.addEventListener("misty:app-update-notice", show);
    return () => window.removeEventListener("misty:app-update-notice", show);
  }, []);
  useEffect(() => {
    if (!accountId || !enabled || !hasTauriInternals()) return;
    let closed = false, checking = false, last = 0;
    const refresh = async () => {
      if (closed || checking || Date.now() - last < 5 * 60_000) return;
      checking = true; last = Date.now();
      try {
        await useAppsStore.getState().load(accountId, true);
        if (closed) return;
        const update = await check({timeout:30_000});
        try { if (!closed) setHostVersion(update?.version ?? ""); }
        finally { await update?.close(); }
      } catch { /* Manual checking in Settings exposes connection errors. */ }
      finally { checking = false; }
    };
    const run = () => { void refresh(); };
    run();
    const timer = window.setInterval(run, 30 * 60_000);
    window.addEventListener("focus", run);
    return () => { closed = true; clearInterval(timer); window.removeEventListener("focus", run); };
  }, [accountId, enabled]);
  if ((!hostVersion && !updates.length && !notice) || key === dismissed) return null;
  return <div role="status" className="fixed bottom-4 right-4 z-50 max-w-sm rounded-xl border border-charcoal-border bg-charcoal-card p-4 text-sm text-cream shadow-lg">
    <p>{notice || (hostVersion ? `Misty ${hostVersion} is available.` : `${updates.length} app update${updates.length === 1 ? " is" : "s are"} available.`)}</p>
    <div className="mt-3 flex justify-end gap-3">
      <button onClick={() => {setDismissed(key); setNotice("");}}>Dismiss</button>
      {!notice && <button className="rounded border border-charcoal-border px-3 py-1" onClick={() => {
        if (hostVersion) window.dispatchEvent(new CustomEvent("misty:open-settings", {detail:{section:"updates"}}));
        else navigate("/discover?section=installed");
      }}>Review update{!hostVersion && updates.length !== 1 ? "s" : ""}</button>}
    </div>
  </div>;
}
