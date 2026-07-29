import { useCallback, useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";

import { hasTauriInternals } from "@/platform/tauri";
import { Button, Progress } from "@/ui";
import { DesktopSettingsRow } from "@/pages/Settings/DesktopSettingsUI";
import {
  applyUpdateProgress,
  EMPTY_UPDATE_PROGRESS,
  readableUpdateError,
  type UpdateProgress,
} from "./updateProgress";

type UpdateState = "idle" | "checking" | "available" | "current" | "installing" | "error";

let checkedThisSession = false;

export function DesktopUpdaterSettings() {
  const updateRef = useRef<Update | null>(null);
  const busyRef = useRef(false);
  const [version, setVersion] = useState("0.1.0");
  const [state, setState] = useState<UpdateState>("idle");
  const [availableVersion, setAvailableVersion] = useState("");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<UpdateProgress>(EMPTY_UPDATE_PROGRESS);
  const supported = hasTauriInternals();

  const releaseUpdate = useCallback(async () => {
    const update = updateRef.current;
    updateRef.current = null;
    if (update) await update.close().catch(() => undefined);
  }, []);

  const checkForUpdates = useCallback(async () => {
    if (!supported || busyRef.current) return;
    busyRef.current = true;
    await releaseUpdate();
    setState("checking");
    setError("");
    try {
      const nextUpdate = await check({ timeout: 30_000 });
      if (!nextUpdate) {
        setAvailableVersion("");
        setState("current");
        return;
      }
      updateRef.current = nextUpdate;
      setAvailableVersion(nextUpdate.version);
      setState("available");
    } catch (cause) {
      setError(readableUpdateError(cause));
      setState("error");
    } finally {
      busyRef.current = false;
    }
  }, [releaseUpdate, supported]);

  useEffect(() => {
    if (!supported) return;
    void getVersion()
      .then(setVersion)
      .catch(() => undefined);
    if (!checkedThisSession) {
      checkedThisSession = true;
      void checkForUpdates();
    }
    return () => {
      void releaseUpdate();
    };
  }, [checkForUpdates, releaseUpdate, supported]);

  async function installUpdate() {
    const update = updateRef.current;
    if (!update || busyRef.current) return;
    busyRef.current = true;
    setState("installing");
    setError("");
    setProgress(EMPTY_UPDATE_PROGRESS);
    try {
      await update.downloadAndInstall((event) => {
        setProgress((current) => applyUpdateProgress(current, event));
      });
      await relaunch();
    } catch (cause) {
      setError(readableUpdateError(cause));
      setState("error");
      busyRef.current = false;
    }
  }

  const status =
    state === "checking"
      ? "Checking…"
      : state === "current"
        ? "You’re up to date"
        : state === "available"
          ? `Version ${availableVersion} is ready`
          : state === "installing"
            ? progress.percent === null
              ? "Downloading update…"
              : `Downloading update… ${progress.percent}%`
            : state === "error"
              ? error
              : "Not checked";

  return (
    <>
      <DesktopSettingsRow label="Version">
        <span className="font-mono text-xs text-muted-foreground">v{version}-beta</span>
      </DesktopSettingsRow>
      <DesktopSettingsRow label="Release channel">
        <span className="text-sm text-foreground">Beta</span>
      </DesktopSettingsRow>
      <DesktopSettingsRow
        label="App updates"
        description="Misty verifies every update’s signature before installation."
      >
        <div className="grid w-full max-w-sm justify-items-end gap-2 max-[760px]:justify-items-start">
          <div className="flex flex-wrap items-center justify-end gap-2 max-[760px]:justify-start">
            <span
              className={
                state === "error" ? "text-xs text-destructive" : "text-xs text-muted-foreground"
              }
              role={state === "error" ? "alert" : "status"}
            >
              {supported ? status : "Available in packaged desktop builds"}
            </span>
            {state === "available" ? (
              <Button size="sm" type="button" onClick={() => void installUpdate()}>
                Install and restart
              </Button>
            ) : (
              <Button
                size="sm"
                type="button"
                variant="outline"
                disabled={!supported || state === "checking" || state === "installing"}
                onClick={() => void checkForUpdates()}
              >
                Check now
              </Button>
            )}
          </div>
          {state === "installing" && progress.percent !== null ? (
            <Progress
              aria-label="Update download progress"
              className="h-1.5 w-full"
              value={progress.percent}
            />
          ) : null}
        </div>
      </DesktopSettingsRow>
    </>
  );
}
