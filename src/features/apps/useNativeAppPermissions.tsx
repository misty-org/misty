import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from "@/shared/ui";
import { runExtensionThemeCommand, revertExtensionThemePreview } from "@/features/settings";
import { encodeNativeAppValue } from "./nativeAppWire";

const appearanceCommands: Record<string, string> = {
  "appearance.snapshot": "themes.snapshot",
  "appearance.preview": "themes.preview",
  "appearance.apply": "themes.apply",
  "appearance.preset": "themes.applyPreset",
  "appearance.revert": "themes.revert",
};
const methods = new Set([
  ...Object.keys(appearanceCommands),
  "backups.status",
  "backups.repositoryOpen",
  "backups.repositoryClose",
  "backups.backupStart",
  "backups.restoreStart",
  "backups.snapshotsStart",
  "backups.checkStart",
  "backups.jobStatus",
  "backups.jobCancel",
  "backups.jobClose",
  "downloads.status",
  "downloads.inspectStart",
  "downloads.downloadStart",
  "downloads.jobStatus",
  "downloads.jobCancel",
  "downloads.jobClose",
  "files.sources.list",
  "files.sources.open",
  "files.pick",
  "media.status",
  "media.convertStart",
  "media.convertStatus",
  "media.convertCancel",
  "media.convertCollect",
  "media.convertClose",
  "files.pickMany",
  "files.release",
  "files.readBytes",
  "files.createCopy",
  "files.appendCopy",
  "files.commitCopy",
  "files.replaceCopy",
  "files.openExternal",
  "files.listArchive",
  "files.discardCopy",
  "files.listSavedDirectories",
  "files.rememberDirectory",
  "files.reopenDirectory",
  "files.forgetDirectory",
  "files.shareDirectory",
  "files.adoptDirectory",
  "files.cancelDirectoryShare",
  "files.pickDirectory",
  "files.openTrash",
  "files.listDirectory",
  "files.stat",
  "files.watchDirectory",
  "files.watchStatus",
  "files.watchClose",
  "files.transferStart",
  "files.transferStatus",
  "files.transferCancel",
  "files.transferClose",
  "files.createEntry",
  "files.renameEntry",
  "files.removeEntry",
  "files.openEntry",
  "files.scanStart",
  "files.scanStatus",
  "files.scanCancel",
  "files.scanClose",
  "files.readText",
  "files.writeText",
  "clipboard.readText",
  "clipboard.writeText",
  "clipboard.writeImage",
  "clipboard.readImage",
  "network.fetch",
  "microphone.capture",
  "camera.capture",
  "permissions.list",
  "permissions.revoke",
]);
export function isNativeDeviceMethod(method: unknown): method is string {
  return typeof method === "string" && methods.has(method);
}
interface PermissionStatus {
  appId: string;
  capability: string;
  granted: boolean;
}
interface Prompt extends PermissionStatus {
  resolve: (allowed: boolean) => void;
}
const descriptions: Record<string, string> = {
  "appearance.write": "Preview and save Misty’s appearance",
  "media.convert": "Convert chosen media using Misty’s isolated converter",
  "media.download": "Connect to public media sites and save downloads in a folder you choose",
  "backups.manage": "Create, verify, and restore encrypted backups using folders you choose",
  "files.read": "Read files you choose",
  "files.open": "Open chosen files in their native applications",
  "files.write": "Create, change, rename, and delete chosen files and folder contents",
  "clipboard.read": "Read text or images from your clipboard",
  "clipboard.write": "Copy text or images to your clipboard",
  "microphone.capture": "Record audio using your microphone",
  "camera.capture": "Record video using your camera",
};
function description(capability: string) {
  return capability.startsWith("network.fetch@")
    ? `Connect to ${capability.slice("network.fetch@".length)}`
    : (descriptions[capability] ?? capability);
}

export function useNativeAppPermissions(title: string) {
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const pending = useRef<Prompt | null>(null);
  const [manage, setManage] = useState(false);
  const [grants, setGrants] = useState<string[]>([]);
  const [error, setError] = useState("");
  const owner = useRef("");
  const alive = useRef(true);
  const recording = useRef<AbortController | null>(null);
  const [recordingNow, setRecordingNow] = useState(false);
  useEffect(() => {
    alive.current = true;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<{ instance: string; capability?: string }>(
      "misty:mini-app-revoked",
      (event) => {
        if (event.payload.instance === owner.current) {
          recording.current?.abort();
          if (event.payload.capability === "appearance.write")
            revertExtensionThemePreview(owner.current);
        }
      },
      { target: { kind: "Webview", label: "main" } },
    )
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(() => undefined);
    return () => {
      alive.current = false;
      disposed = true;
      unlisten?.();
      pending.current?.resolve(false);
      pending.current = null;
      recording.current?.abort();
      revertExtensionThemePreview(owner.current);
    };
  }, []);
  const ask = (status: PermissionStatus, signal?: AbortSignal) =>
    new Promise<boolean>((resolve) => {
      if (!alive.current || pending.current || signal?.aborted) {
        resolve(false);
        return;
      }
      const cancel = () => {
        if (pending.current === next) {
          pending.current = null;
          setPrompt(null);
        }
        next.resolve(false);
      };
      const next = {
        ...status,
        resolve: (allowed: boolean) => {
          signal?.removeEventListener("abort", cancel);
          resolve(allowed);
        },
      };
      pending.current = next;
      setPrompt(next);
      signal?.addEventListener("abort", cancel, { once: true });
    });
  const decide = (allowed: boolean) => {
    const current = pending.current;
    pending.current = null;
    setPrompt(null);
    current?.resolve(allowed);
  };
  const refresh = async (instance: string) => {
    const result = await invoke<string[]>("mini_app_permission_list", { instance });
    if (alive.current) setGrants(result);
    return result;
  };
  const revoke = async (instance: string, capability: string) => {
    await invoke("mini_app_permission_decide", { instance, capability, allowed: false });
    recording.current?.abort();
    if (capability === "appearance.write") revertExtensionThemePreview(instance);
    return refresh(instance);
  };
  const execute = async (
    instance: string,
    method: string,
    params: unknown,
    assertAuthorized: () => void = () => undefined,
    signal?: AbortSignal,
  ) => {
    const assertLive = () => {
      if (!alive.current || signal?.aborted) throw new Error("App request expired or closed.");
      assertAuthorized();
    };
    assertLive();
    owner.current = instance;
    const input = params && typeof params === "object" ? (params as Record<string, unknown>) : {};
    // The public palette is already visible in the Host UI; no device or account data.
    if (method === "appearance.snapshot") {
      await invoke("mini_app_context", { instance });
      assertLive();
      return runExtensionThemeCommand("themes.snapshot", {}, instance);
    }
    if (
      method === "files.release" ||
      method === "files.cancelDirectoryShare" ||
      method === "files.forgetDirectory" ||
      method === "media.status" ||
      method === "backups.status" ||
      method === "downloads.status"
    )
      return invoke("mini_app_device_call", {
        instance,
        method,
        params: encodeNativeAppValue(input),
      });
    if (method === "permissions.list") return refresh(instance);
    if (method === "permissions.revoke") {
      if (typeof input.capability !== "string") throw new Error("Missing capability.");
      return revoke(instance, input.capability);
    }
    const status = await invoke<PermissionStatus>("mini_app_permission_status", {
      instance,
      method,
      params: encodeNativeAppValue(input),
    });
    if (!status.granted) {
      const allowed = await ask(status, signal);
      if (!allowed || !alive.current) {
        if (alive.current)
          await invoke("mini_app_permission_decide", {
            instance,
            capability: status.capability,
            allowed: false,
          }).catch(() => undefined);
        throw new Error("Permission was not granted.");
      }
      assertLive();
      await invoke("mini_app_permission_decide", {
        instance,
        capability: status.capability,
        allowed: true,
      });
      if (signal?.aborted || !alive.current) {
        await revoke(instance, status.capability).catch(() => undefined);
        throw new Error("App request expired or closed.");
      }
      await refresh(instance);
    }
    assertLive();
    if (Object.prototype.hasOwnProperty.call(appearanceCommands, method)) {
      const check = await invoke<PermissionStatus>("mini_app_permission_status", {
        instance,
        method,
        params: encodeNativeAppValue(input),
      });
      assertLive();
      if (!check.granted) throw new Error("Appearance permission was revoked.");
      return runExtensionThemeCommand(appearanceCommands[method], input, instance);
    }
    if (method === "microphone.capture" || method === "camera.capture") {
      if (recording.current) throw new Error("This App is already recording.");
      const abort = new AbortController();
      const cancel = () => abort.abort();
      signal?.addEventListener("abort", cancel, { once: true });
      recording.current = abort;
      setRecordingNow(true);
      try {
        const result = await capture(method === "camera.capture", input.seconds, abort.signal);
        const check = await invoke<PermissionStatus>("mini_app_permission_status", {
          instance,
          method,
          params: {},
        });
        if (!check.granted || !alive.current || abort.signal.aborted)
          throw new Error("Recording permission was revoked.");
        return result;
      } finally {
        signal?.removeEventListener("abort", cancel);
        recording.current = null;
        if (alive.current) setRecordingNow(false);
      }
    }
    return invoke("mini_app_device_call", {
      instance,
      method,
      params: encodeNativeAppValue(input),
    });
  };
  const open = async (instance: string) => {
    owner.current = instance;
    setError("");
    setManage(true);
    try {
      await refresh(instance);
    } catch (error) {
      setError(String(error));
    }
  };
  return {
    execute,
    open,
    reset: () => {
      pending.current?.resolve(false);
      pending.current = null;
      recording.current?.abort();
      revertExtensionThemePreview(owner.current);
      owner.current = "";
      setPrompt(null);
      setManage(false);
      setGrants([]);
    },
    active: Boolean(prompt) || manage || recordingNow,
    controls: (
      <>
        <Dialog
          open={Boolean(prompt)}
          onOpenChange={(open) => {
            if (!open) decide(false);
          }}
        >
          <DialogContent>
            <DialogTitle>
              Allow {title} to{" "}
              {prompt ? description(prompt.capability).toLowerCase() : "use this feature"}?
            </DialogTitle>
            <DialogDescription>
              App: {prompt?.appId}. Access lasts until you close this app. You can revoke it from
              App permissions at any time.
            </DialogDescription>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => decide(false)}>
                Don’t allow
              </Button>
              <Button onClick={() => decide(true)}>Allow for this session</Button>
            </div>
          </DialogContent>
        </Dialog>
        <Dialog open={manage} onOpenChange={setManage}>
          <DialogContent>
            <DialogTitle>{title} permissions</DialogTitle>
            <DialogDescription>
              These permissions apply to this open app. Closing it removes all access and selected
              file handles.
            </DialogDescription>
            {error ? <p role="alert">{error}</p> : null}
            {grants.length === 0 ? (
              <p>No permissions granted.</p>
            ) : (
              grants.map((capability) => (
                <div key={capability} className="flex items-center justify-between gap-4">
                  <span>{description(capability)}</span>
                  <Button
                    variant="outline"
                    onClick={() => {
                      void revoke(owner.current, capability).catch((error) =>
                        setError(String(error)),
                      );
                    }}
                  >
                    Revoke
                  </Button>
                </div>
              ))
            )}
          </DialogContent>
        </Dialog>
        <Dialog
          open={recordingNow}
          onOpenChange={(open) => {
            if (!open) recording.current?.abort();
          }}
        >
          <DialogContent>
            <DialogTitle>{title} is recording</DialogTitle>
            <DialogDescription>
              The recording ends automatically. Cancel stops the microphone or camera and discards
              this recording.
            </DialogDescription>
            <Button onClick={() => recording.current?.abort()}>Cancel recording</Button>
          </DialogContent>
        </Dialog>
      </>
    ),
  };
}

async function capture(video: boolean, requestedSeconds: unknown, signal: AbortSignal) {
  const seconds =
    typeof requestedSeconds === "number" && Number.isFinite(requestedSeconds)
      ? Math.min(30, Math.max(1, requestedSeconds))
      : 5;
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined")
    throw new Error("Recording is unavailable on this device.");
  // A camera grant does not imply microphone access.
  const stream = await navigator.mediaDevices.getUserMedia(
    video
      ? { video: { width: { ideal: 640 }, height: { ideal: 360 } }, audio: false }
      : { audio: true, video: false },
  );
  try {
    if (signal.aborted) throw new Error("Recording cancelled.");
    return await new Promise<{ mimeType: string; bytes: ArrayBuffer }>((resolve, reject) => {
      const recorder = new MediaRecorder(
        stream,
        video ? { videoBitsPerSecond: 80_000 } : { audioBitsPerSecond: 32_000 },
      );
      const chunks: Blob[] = [];
      let size = 0;
      let failure = "";
      const stop = () => {
        stream.getTracks().forEach((track) => track.stop());
        if (recorder.state !== "inactive") recorder.stop();
      };
      const abort = () => {
        failure = "Recording cancelled or permission revoked.";
        stop();
      };
      const timer = window.setTimeout(stop, seconds * 1000);
      signal.addEventListener("abort", abort, { once: true });
      recorder.ondataavailable = (event) => {
        size += event.data.size;
        if (size > 200_000) {
          failure = "Recording is too large. Use a shorter duration.";
          stop();
        } else chunks.push(event.data);
      };
      recorder.onerror = () => {
        failure = "Recording failed.";
        stop();
      };
      recorder.onstop = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        if (failure) {
          reject(new Error(failure));
          return;
        }
        const blob = new Blob(chunks, { type: recorder.mimeType });
        void blob.arrayBuffer().then((bytes) => resolve({ mimeType: blob.type, bytes }), reject);
      };
      try {
        recorder.start(250);
      } catch (error) {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        reject(error);
      }
    });
  } finally {
    stream.getTracks().forEach((track) => track.stop());
  }
}
