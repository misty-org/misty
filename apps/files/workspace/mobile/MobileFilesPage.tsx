import { spacesApi } from "@/api/spaces/api";
import { readActiveSavedAccountSession } from "@/features/auth";
import { peerIsOnline, useConnectedDevices } from "@/features/connected-devices";
import { useWorkspaceStore } from "@/features/workspace/core";
import {
  connectedDevicesListDirectory,
  connectedDevicesMediaUrl,
  connectedDevicesRoots,
} from "@/native/connected-devices";
import type { PeerEntry } from "@/native/contracts";
import { mobileCacheRead, mobileCacheWrite } from "@/native/mobile-cache";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import { ChevronLeft, Eye, FilePlus2, Files, Folder, Library, Monitor, Share } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/shared/ui";
import { useMobileSurfaceChrome } from "@/shared/mobile";

const PdfViewer = lazy(() => import("../explorer/components/PdfViewer"));

interface RecentMobileFile {
  path: string;
  name: string;
  importedAt: string;
}

interface MobileRemotePreview {
  kind: "image" | "video" | "audio" | "pdf";
  name: string;
  url: string;
}

const imagePreviewExtensions = new Set([
  "avif",
  "bmp",
  "gif",
  "heic",
  "heif",
  "jpeg",
  "jpg",
  "png",
  "webp",
]);
const videoPreviewExtensions = new Set(["m4v", "mov", "mp4", "webm"]);
const audioPreviewExtensions = new Set(["m4a", "mp3", "oga", "ogg", "wav"]);

export function mobileRemotePreviewKind(name: string): MobileRemotePreview["kind"] | null {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  if (imagePreviewExtensions.has(extension)) return "image";
  if (videoPreviewExtensions.has(extension)) return "video";
  if (audioPreviewExtensions.has(extension)) return "audio";
  return extension === "pdf" ? "pdf" : null;
}

const recentFilesKey = "mobile-files-recent";

export function MobileFilesPage() {
  useMobileSurfaceChrome({ title: "Files", level: "root" });
  const accountId = readActiveSavedAccountSession()?.id ?? "";
  const scopeKey = useWorkspaceStore((state) => state.activeScopeKey);
  const connected = useConnectedDevices();
  const spaceId = scopeKey.startsWith("space:") ? scopeKey.slice("space:".length) : "";
  const [recent, setRecent] = useState<RecentMobileFile[]>([]);
  const [busyPath, setBusyPath] = useState("");
  const [status, setStatus] = useState("");
  const [remote, setRemote] = useState<{
    deviceId: string;
    deviceName: string;
    path: string;
    entries: PeerEntry[];
    history: string[];
  } | null>(null);
  const [preview, setPreview] = useState<MobileRemotePreview | null>(null);

  useEffect(() => {
    if (!accountId) return;
    void mobileCacheRead<RecentMobileFile[]>(accountId, recentFilesKey).then((saved) => {
      if (saved) setRecent(saved.slice(0, 20));
    });
  }, [accountId]);

  const sorted = useMemo(
    () => [...recent].sort((left, right) => right.importedAt.localeCompare(left.importedAt)),
    [recent],
  );

  const chooseFiles = async () => {
    setStatus("");
    const selected = await open({ multiple: true, directory: false });
    const paths = Array.isArray(selected) ? selected : selected ? [selected] : [];
    if (!paths.length) return;
    const now = new Date().toISOString();
    const next = [
      ...paths.map((path) => ({ path, name: fileName(path), importedAt: now })),
      ...recent.filter((item) => !paths.includes(item.path)),
    ].slice(0, 20);
    setRecent(next);
    if (accountId) await mobileCacheWrite(accountId, recentFilesKey, next);
  };

  const addToLibrary = async (file: RecentMobileFile) => {
    if (!spaceId) {
      setStatus("Choose a Space before adding a file to its Library.");
      return;
    }
    if (!navigator.onLine) {
      setStatus("Adding files is unavailable offline. The file was not queued.");
      return;
    }
    setBusyPath(file.path);
    setStatus("");
    try {
      await spacesApi.uploadLibraryPath(spaceId, file.path, "library");
      setStatus(`${file.name} was added to the Space Library.`);
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : "The file could not be added.");
    } finally {
      setBusyPath("");
    }
  };

  const onlinePeers = connected.peers.filter((peer) => {
    const native = connected.snapshot?.peers.find((item) => item.deviceId === peer.deviceId);
    return peerIsOnline(peer) && native?.state === "online";
  });

  const openDevice = async (deviceId: string, deviceName: string) => {
    setStatus("");
    try {
      const root = (await connectedDevicesRoots(deviceId))[0];
      if (!root) throw new Error("This device is not sharing any locations.");
      const path = `misty://device/${deviceId}/${root.id}`;
      await openRemoteDirectory(deviceId, deviceName, path, []);
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : "The device could not be opened.");
    }
  };

  const openRemoteDirectory = async (
    deviceId: string,
    deviceName: string,
    path: string,
    history: string[],
  ) => {
    const response = await connectedDevicesListDirectory({ deviceId, path });
    if (response.type !== "directory") throw new Error("The shared folder could not be opened.");
    setRemote({ deviceId, deviceName, path, entries: response.data.entries, history });
  };

  const previewRemoteFile = async (entry: PeerEntry) => {
    const kind = mobileRemotePreviewKind(entry.name);
    if (!kind) {
      setStatus("Preview is available for images, audio, video, and PDF files.");
      return;
    }
    try {
      setPreview({ kind, name: entry.name, url: await connectedDevicesMediaUrl(entry.path) });
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : "A preview is unavailable.");
    }
  };

  return (
    <section className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col bg-charcoal-bg">
      <div className="border-b border-charcoal-border px-4 py-4">
        <h1 className="text-lg font-semibold tracking-[-0.02em] text-cream-bright">Files</h1>
        <p className="mt-1 text-sm leading-5 text-cream-muted">
          Import with Apple Files, then add selected items to the active Space Library.
        </p>
        <button
          type="button"
          className="mt-4 flex min-h-11 items-center gap-2 rounded-md bg-charcoal-active px-4 text-sm font-medium text-cream-bright"
          onClick={() => void chooseFiles()}
        >
          <FilePlus2 size={18} aria-hidden="true" />
          Import from Files
        </button>
      </div>
      {status ? (
        <p
          className="border-b border-charcoal-border px-4 py-3 text-sm text-cream-muted"
          role="status"
        >
          {status}
        </p>
      ) : null}
      <div className="misty-transient-scrollbar min-h-0 flex-1 overflow-y-auto p-3">
        <h2 className="px-2 pb-2 text-xs font-semibold text-cream-muted">Connected devices</h2>
        {remote ? (
          <div className="mb-5 rounded-xl border border-charcoal-border bg-charcoal-card/40 p-1">
            <button
              type="button"
              className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-sm text-cream-bright active:bg-charcoal-active"
              onClick={() => {
                const previous = remote.history[remote.history.length - 1];
                if (!previous) {
                  setRemote(null);
                  return;
                }
                void openRemoteDirectory(
                  remote.deviceId,
                  remote.deviceName,
                  previous,
                  remote.history.slice(0, -1),
                );
              }}
            >
              <ChevronLeft size={18} aria-hidden="true" />
              <span className="truncate">{remote.deviceName}</span>
              <span className="ml-auto text-xs text-sage-fg">Read-only</span>
            </button>
            {remote.entries.map((entry) => (
              <button
                key={entry.path}
                type="button"
                className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left active:bg-charcoal-active"
                onClick={() => {
                  if (entry.kind === "directory") {
                    void openRemoteDirectory(remote.deviceId, remote.deviceName, entry.path, [
                      ...remote.history,
                      remote.path,
                    ]);
                  } else if (entry.kind === "file") {
                    void previewRemoteFile(entry);
                  }
                }}
              >
                {entry.kind === "directory" ? (
                  <Folder size={19} className="text-avatar-aqua" aria-hidden="true" />
                ) : (
                  <Files size={19} className="text-cream-muted" aria-hidden="true" />
                )}
                <span className="min-w-0 flex-1 truncate text-sm text-cream-bright">
                  {entry.name}
                </span>
              </button>
            ))}
          </div>
        ) : onlinePeers.length ? (
          <div className="mb-5 grid gap-1">
            {onlinePeers.map((peer) => (
              <button
                key={peer.pairId}
                type="button"
                className="flex min-h-12 items-center gap-3 rounded-lg px-3 text-left active:bg-charcoal-card"
                onClick={() => void openDevice(peer.deviceId, peer.name)}
              >
                <Monitor size={19} className="text-sage-fg" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-sm text-cream-bright">
                  {peer.name}
                </span>
                <span className="text-xs text-sage-fg">Online</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="mb-5 px-2 text-sm text-cream-muted">No paired device is online.</p>
        )}
        <h2 className="px-2 pb-2 text-xs font-semibold text-cream-muted">Recent imports</h2>
        {sorted.length ? (
          <ul className="m-0 grid list-none gap-1 p-0">
            {sorted.map((file) => (
              <li
                key={file.path}
                className="grid min-h-14 grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-3 active:bg-charcoal-card"
              >
                <Files size={19} className="text-cream-muted" aria-hidden="true" />
                <span className="min-w-0 truncate text-[15px] text-cream-bright">{file.name}</span>
                <span className="flex items-center">
                  <button
                    type="button"
                    aria-label={`Preview ${file.name}`}
                    className="grid size-11 place-items-center rounded-lg text-cream-muted active:bg-charcoal-active active:text-cream-bright"
                    onClick={() => void openPath(file.path)}
                  >
                    <Eye size={18} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Add ${file.name} to Library`}
                    className="grid size-11 place-items-center rounded-lg text-cream-muted active:bg-charcoal-active active:text-cream-bright disabled:opacity-50"
                    disabled={Boolean(busyPath)}
                    onClick={() => void addToLibrary(file)}
                  >
                    <Library size={18} aria-hidden="true" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="grid min-h-56 place-items-center px-8 text-center">
            <div>
              <Share className="mx-auto mb-3 text-cream-muted" size={24} aria-hidden="true" />
              <h2 className="text-base font-medium text-cream-bright">Choose files to begin</h2>
              <p className="mt-1 text-sm leading-5 text-cream-muted">
                Misty never exposes application paths or assumes access beyond your selection.
              </p>
            </div>
          </div>
        )}
      </div>
      <Sheet open={Boolean(preview)} onOpenChange={(open) => !open && setPreview(null)}>
        <SheetContent
          side="bottom"
          className="h-[min(82dvh,760px)] gap-0 overflow-hidden rounded-t-2xl p-0 pb-[env(safe-area-inset-bottom)]"
        >
          <SheetHeader className="border-b border-charcoal-border px-4 py-3 text-left">
            <SheetTitle className="truncate">{preview?.name}</SheetTitle>
          </SheetHeader>
          {preview?.kind === "image" ? (
            <div className="grid min-h-0 flex-1 place-items-center overflow-auto bg-charcoal-card p-4">
              <img
                src={preview.url}
                alt={`Preview of ${preview.name}`}
                className="max-h-full max-w-full object-contain"
                draggable={false}
              />
            </div>
          ) : preview?.kind === "video" ? (
            <div className="grid min-h-0 flex-1 place-items-center bg-black p-3">
              <video
                src={preview.url}
                aria-label={`Video preview of ${preview.name}`}
                className="max-h-full max-w-full"
                controls
                playsInline
                preload="metadata"
              />
            </div>
          ) : preview?.kind === "audio" ? (
            <div className="grid min-h-0 flex-1 place-items-center bg-charcoal-card p-6">
              <audio
                src={preview.url}
                aria-label={`Audio preview of ${preview.name}`}
                className="w-full max-w-lg"
                controls
                preload="metadata"
              />
            </div>
          ) : preview?.kind === "pdf" ? (
            <Suspense
              fallback={
                <div className="grid min-h-0 flex-1 place-items-center bg-charcoal-card text-sm text-cream-muted">
                  Loading PDF…
                </div>
              }
            >
              <div className="min-h-0 flex-1">
                <PdfViewer url={preview.url} name={preview.name} />
              </div>
            </Suspense>
          ) : null}
        </SheetContent>
      </Sheet>
    </section>
  );
}

function fileName(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/$/, "");
  return normalized.split("/").pop() || "Selected file";
}
