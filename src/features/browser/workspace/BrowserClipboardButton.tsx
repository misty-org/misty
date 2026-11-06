import { ClipboardList } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  cloudClipboardChangedEvent,
  cloudClipboardCopy,
  cloudClipboardPaste,
  cloudClipboardSave,
  cloudClipboardView,
  type CloudClip,
  type CloudClipboardView,
} from "@/native/cloud-clipboard";
import { errorText } from "@/shared/lib/format";
import { formatBytes } from "@/shared/lib/fileFormat";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { Button, ErrorNotification, MenuSubmenu, SkeletonList } from "@/shared/ui";
import { ShortcutText } from "@/features/shortcuts";
import { listen } from "@tauri-apps/api/event";

const statusText: Record<CloudClipboardView["status"], string> = {
  off: "Clipboard sharing is off for this signed-in session.",
  locked: "Unlock sync on this computer to share your clipboard.",
  connecting: "Connecting to your shared clipboard.",
  ready: "",
  unavailable: "",
};

/**
 * Everything copied on this account's devices in the last 24 hours, as a submenu of the browser
 * menu. It is its own buffer: Paste latest types the newest clip into the page and Copy puts one
 * on this device's clipboard, and nothing else ever changes the system clipboard. The menu mounts it fresh each time it opens.
 */
export function BrowserClipboardButton(props: { pageId: string }) {
  const [view, setView] = useState<CloudClipboardView | null>(null);
  const [message, setMessage] = useState("");
  const [failure, setFailure] = useState("");
  const refresh = useCallback(() => {
    if (!hasTauriInternals()) return;
    void cloudClipboardView()
      .then(setView)
      .catch(() => setView({ status: "unavailable", clips: [], notice: null }));
  }, []);

  useEffect(() => {
    refresh();
    if (!hasTauriInternals()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen(cloudClipboardChangedEvent, refresh).then((remove) => {
      if (disposed) remove();
      else unlisten = remove;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [refresh]);

  const run = (action: () => Promise<string>) => {
    setMessage("");
    setFailure("");
    void action()
      .then(setMessage)
      .catch((error: unknown) => setFailure(errorText(error)));
  };

  const newest = view?.clips[0];
  return (
    <MenuSubmenu icon={<ClipboardList />} label="Clipboard" width="lg">
      <div className="grid gap-1">
        {view === null ? (
          <SkeletonList label="Loading clips" rows={3} lines={2} className="px-1" />
        ) : (
          <>
            {statusText[view.status] ? (
              <p className="px-2 py-1 text-sm text-cream-muted">{statusText[view.status]}</p>
            ) : null}
            {view.notice ? (
              <p className="px-2 py-1 text-xs text-cream-muted">{view.notice}</p>
            ) : null}
            {view.status === "off" ? (
              <Button
                variant="ghost"
                size="sm"
                justify="start"
                className="w-full font-normal"
                onClick={() => {
                  window.dispatchEvent(
                    new CustomEvent("misty:open-settings", { detail: { section: "sync" } }),
                  );
                }}
              >
                Open Sync settings
              </Button>
            ) : null}
            {view.status !== "off" && view.clips.length === 0 ? (
              <p className="px-2 py-1 text-sm text-cream-muted">
                Everything you copy while signed in shows up here for 24 hours.
              </p>
            ) : null}
            {newest && newest.kind !== "image" ? (
              <Button
                variant="ghost"
                size="sm"
                justify="start"
                className="w-full font-normal"
                onClick={() =>
                  run(async () => {
                    await cloudClipboardPaste(props.pageId);
                    return "Pasted into the page.";
                  })
                }
              >
                <span className="min-w-0 flex-1 truncate text-left">Paste latest</span>
                <ShortcutText commandId="browser.cloud_paste" />
              </Button>
            ) : null}
            <ul className="grid">
              {view.clips.map((clip) => (
                <ClipRow
                  key={clip.clipId}
                  clip={clip}
                  onCopy={() =>
                    run(async () => {
                      await cloudClipboardCopy(clip.clipId);
                      return "Copied to this computer.";
                    })
                  }
                  onSave={() =>
                    run(async () => {
                      await cloudClipboardSave(clip.clipId);
                      return "Saved to Downloads.";
                    })
                  }
                />
              ))}
            </ul>
          </>
        )}
        <ErrorNotification
          message={
            failure ||
            (view?.status === "unavailable" ? "Your shared clipboard can't be reached right now." : "")
          }
          onDismiss={() => setFailure("")}
        />
        {message ? (
          <p role="status" className="px-2 pb-1 text-xs text-cream-muted">
            {message}
          </p>
        ) : null}
      </div>
    </MenuSubmenu>
  );
}

function ClipRow(props: { clip: CloudClip; onCopy: () => void; onSave: () => void }) {
  const { clip } = props;
  // Copied files cross as their names only; only images can be saved.
  const isImage = clip.kind === "image";
  const title = isImage
    ? "Image"
    : clip.fileNames.length > 0
      ? clip.fileNames.join(", ")
      : clip.preview || "Text";
  const source = clip.fromThisDevice
    ? "This computer"
    : clip.deviceName || "Another signed-in session";
  return (
    <li className="flex items-center gap-2 px-2 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-cream-bright">{title}</p>
        <p className="truncate text-xs text-cream-muted">
          {source} · {clipAge(clip.createdAt)}
          {isImage && clip.size ? ` · ${formatBytes(clip.size)}` : ""}
        </p>
      </div>
      {isImage ? (
        <Button variant="toolbar" size="xs" onClick={props.onSave}>
          Save
        </Button>
      ) : null}
      <Button variant="toolbar" size="xs" onClick={props.onCopy}>
        Copy
      </Button>
    </li>
  );
}

function clipAge(createdAt: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - createdAt) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return `${hours} hr ago`;
}
