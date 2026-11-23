import { useNotice } from "@misty/ui";
import { useEffect, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@/native/invoke";
import { settingsBoolean, useSettingsStore } from "@/features/settings";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { ReleaseNotesDialog } from "./ReleaseNotesDialog";
import { UpdatePromptDialog } from "./UpdatePromptDialog";
import { requestUpdateCheck } from "./update_check_request";

const minCheckIntervalMs = 6 * 60 * 60_000;
const putOffMs = 6 * 60 * 60_000;
const promptedKey = "misty.updater.prompted:v1";

function claimPrompt(version: string): boolean {
  try {
    const last = JSON.parse(localStorage.getItem(promptedKey) ?? "null") as {
      version?: string;
      at?: number;
    } | null;
    if (last?.version === version && Date.now() - (last.at ?? 0) < putOffMs) return false;
    localStorage.setItem(promptedKey, JSON.stringify({ version, at: Date.now() }));
    return true;
  } catch {
    return true;
  }
}

export function UpdateNotices({ accountScope }: { accountScope: string }) {
  const [hostVersion, setHostVersion] = useState("");
  const [prompt, setPrompt] = useState<Update | null>(null);
  const [notice, setNotice] = useState("");
  const [dismissed, setDismissed] = useState("");
  const enabled = useSettingsStore((s) =>
    settingsBoolean(s.settings?.document ?? {}, "general", "auto_update_enabled", true),
  );
  const key = JSON.stringify([accountScope, hostVersion, notice]);
  useEffect(() => {
    if (!hasTauriInternals()) return;
    void invoke("tray_update", { version: hostVersion }).catch(() => undefined);
  }, [hostVersion]);
  useEffect(() => {
    if (!hasTauriInternals()) return;
    const remove = getCurrentWindow().listen("misty://tray-check-updates", requestUpdateCheck);
    return () => void remove.then((stop) => stop());
  }, []);
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
    const refresh = async () => {
      if (closed || checking || found || Date.now() - last < minCheckIntervalMs) return;
      checking = true;
      last = Date.now();
      try {
        const update = await check({ timeout: 30_000 });
        found = Boolean(update?.version);
        if (!closed) setHostVersion(update?.version ?? "");
        if (update && !closed && claimPrompt(update.version)) setPrompt(update);
        else await update?.close();
      } catch {
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
  const showNotice = Boolean(notice) && key !== dismissed;
  const dismiss = () => {
    setDismissed(key);
    setNotice("");
  };
  useNotice(showNotice, { message: notice, onDismiss: dismiss });
  const later = () => {
    void prompt?.close();
    setPrompt(null);
  };
  return (
    <>
      <ReleaseNotesDialog />
      {prompt ? <UpdatePromptDialog update={prompt} onLater={later} /> : null}
    </>
  );
}
