import { ClipboardList } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  cloudClipboardChangedEvent,
  cloudClipboardCopy,
  cloudClipboardSave,
  cloudClipboardView,
  type CloudClip,
  type CloudClipboardView,
} from "@/native/cloud-clipboard";
import { errorText } from "@/shared/lib/format";
import { formatBytes } from "@/shared/lib/fileFormat";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { Button, MenuSubmenu, SkeletonList } from "@/shared/ui";
import { listen } from "@tauri-apps/api/event";

const statusText: Record<CloudClipboardView["status"], string> = {
  off: "Clipboard sharing is off for this device.",
  locked: "Unlock sync on this device to share your clipboard.",
  connecting: "Connecting to your shared clipboard.",
  ready: "",
  unavailable:
    "Your shared clipboard can't be reached right now. Paired devices on this network still share it.",
};

/**
 * Recent clips from this account's devices, as a submenu of the browser menu. Copying one
 * puts it on this device's clipboard. The menu mounts it fresh each time it opens.
 */
export function BrowserClipboardButton() {
  const [view, setView] = useState<CloudClipboardView | null>(null);
  const [message, setMessage] = useState("");
  const refresh = useCallback(() => {
    if (!hasTauriInternals()) return;
    void cloudClipboardView()
      .then(setView)
      .catch(() => setView({ status: "unavailable", clips: [] }));
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
    void action()
      .then(setMessage)
      .catch((error: unknown) => setMessage(errorText(error)));
  };

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
            {view.status === "off" ? (
              <Button
                variant="ghost"
                size="sm"
                justify="start"
                className="w-full font-normal"
                onClick={() => {
                  window.dispatchEvent(
                    new CustomEvent("misty:open-settings", { detail: { section: "devices" } }),
                  );
                }}
              >
                Open Devices settings
              </Button>
            ) : null}
            {view.status !== "off" && view.clips.length === 0 ? (
              <p className="px-2 py-1 text-sm text-cream-muted">
                Copy something on any of your devices and it shows up here.
              </p>
            ) : null}
            <ul className="grid">
              {view.clips.map((clip) => (
                <ClipRow
                  key={clip.clipId}
                  clip={clip}
                  onCopy={() =>
                    run(async () => {
                      await cloudClipboardCopy(clip.clipId);
                      return "Copied to this device.";
                    })
                  }
                  onSave={() =>
                    run(async () => {
                      const saved = await cloudClipboardSave(clip.clipId);
                      return saved.length === 1
                        ? "Saved to Downloads."
                        : `Saved ${saved.length} files to Downloads.`;
                    })
                  }
                />
              ))}
            </ul>
          </>
        )}
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
  const hasFiles = clip.fileNames.length > 0 || clip.kind === "image";
  const title =
    clip.kind === "file_refs"
      ? clip.fileNames.join(", ") || "Files"
      : clip.kind === "image"
        ? "Image"
        : clip.preview || "Text";
  const source = clip.fromThisDevice ? "This device" : clip.deviceName || "Another device";
  return (
    <li className="flex items-center gap-2 px-2 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-cream-bright">{title}</p>
        <p className="truncate text-xs text-cream-muted">
          {source} · {clipAge(clip.createdAt)}
          {hasFiles && clip.size ? ` · ${formatBytes(clip.size)}` : ""}
        </p>
      </div>
      {hasFiles ? (
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
