import { connectedDevicesPrepareClipboardFiles, connectedDevicesRoots } from "../../../native";
import { reportSystemError } from "@/features/activity";
import {
  deviceLink,
  peerIsOnline,
  type ServerConnectedPeer,
  type useConnectedDevices,
} from "@/features/connected-devices";
import {
  Button,
  cn,
  ContextMenu,
  ContextMenuAction,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/shared/ui";
import {
  ClipboardCopy,
  ClipboardPaste,
  Info,
  Link2,
  Link2Off,
  Lock,
  LockOpen,
  MonitorSmartphone,
  Pencil,
  Unlink,
} from "lucide-react";
import { useState } from "react";
import { sidebarStyles } from "@/features/file-ui";

type Controller = ReturnType<typeof useConnectedDevices>;

export function ConnectedDeviceRow(props: {
  peer: ServerConnectedPeer;
  controller: Controller;
  activePath: string;
  onNavigate: (path: string) => void;
}) {
  const { peer, controller } = props;
  const [busy, setBusy] = useState(false);
  const link = deviceLink(peer, controller.snapshot);
  const connected = link.state === "connected";
  // A pair that never connected, or whose session ended, needs Misty's server
  // once, so the other device must be online for it.
  const needsConnect = link.state === "new" || link.state === "ended";
  const canOpen = connected || (needsConnect && peerIsOnline(peer) && Boolean(peer.addressing));
  const selected = props.activePath.startsWith(`misty://device/${peer.deviceId}/`);

  const run = async (title: string, action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
    } catch (cause) {
      reportSystemError({
        title,
        error: cause instanceof Error ? cause.message : String(cause),
        scope: "files:connected-devices",
        target: { kind: "workspace-tool", tool: "files" },
      });
    } finally {
      setBusy(false);
    }
  };

  const open = () =>
    run(`Couldn't open ${peer.name}`, async () => {
      if (!connected) await controller.connectPeer(peer);
      const roots = await connectedDevicesRoots(peer.deviceId);
      // The system disk first; volumes follow it.
      const root = roots.find((item) => item.kind === "system") ?? roots[0];
      if (root) props.onNavigate(`misty://device/${peer.deviceId}/${root.id}`);
    });

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className={sidebarStyles.deviceNestedTreeRow}>
          <Button
            type="button"
            variant="ghost"
            className={cn(
              sidebarStyles.treeSurface,
              sidebarStyles.deviceButton,
              selected && sidebarStyles.itemSelected,
            )}
            disabled={!canOpen || busy}
            onClick={() => void open()}
          >
            <span className={sidebarStyles.deviceIcon} aria-hidden="true">
              <MonitorSmartphone size={24} strokeWidth={1.9} />
            </span>
            <span className={sidebarStyles.deviceCopy}>
              <strong className={sidebarStyles.deviceName}>{peer.name}</strong>
              <small className={sidebarStyles.deviceMeta}>{linkLabel(link.state, peer)}</small>
            </span>
          </Button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {connected || link.state === "reconnecting" ? (
          <ContextMenuAction
            icon={<Link2Off size={15} />}
            label="Disconnect"
            onSelect={() =>
              void run(`Couldn't disconnect ${peer.name}`, () => controller.endSession(peer))
            }
          />
        ) : (
          <ContextMenuAction
            icon={<Link2 size={15} />}
            label="Connect"
            disabled={!canOpen}
            onSelect={() =>
              void run(`Couldn't connect ${peer.name}`, () => controller.connectPeer(peer))
            }
          />
        )}
        <ContextMenuAction
          icon={peer.filesAcceptWrites ? <Lock size={15} /> : <LockOpen size={15} />}
          label={
            peer.filesAcceptWrites
              ? "Stop changes from this device"
              : "Allow changes from this device"
          }
          onSelect={() =>
            void run("Couldn't update file access", () =>
              controller.setFileWrites(peer, !peer.filesAcceptWrites),
            )
          }
        />
        <ContextMenuAction
          icon={<ClipboardCopy size={15} />}
          label={peer.clipboardCanSend ? "Stop sharing clipboard" : "Share clipboard"}
          onSelect={() =>
            void run("Couldn't update clipboard sharing", () =>
              controller.setClipboardConsent(peer, !peer.clipboardCanSend),
            )
          }
        />
        <ContextMenuAction
          icon={<ClipboardPaste size={15} />}
          label="Prepare copied files for other apps"
          disabled={!peer.clipboardCanSend || !connected}
          onSelect={() =>
            void run("Couldn't prepare the copied files", () =>
              connectedDevicesPrepareClipboardFiles(peer.deviceId),
            )
          }
        />
        <ContextMenuAction
          icon={<Pencil size={15} />}
          label="Rename"
          onSelect={() => {
            const name = window.prompt("Device name", peer.name);
            if (name)
              void run("Couldn't rename the device", () => controller.renamePeer(peer, name));
          }}
        />
        <ContextMenuAction
          icon={<Info size={15} />}
          label="Copy diagnostics ID"
          onSelect={() => void navigator.clipboard.writeText(peer.p2pEndpointId)}
        />
        <ContextMenuAction
          icon={<Unlink size={15} />}
          label="Unpair"
          destructive
          onSelect={() => void run(`Couldn't unpair ${peer.name}`, () => controller.unpair(peer))}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function linkLabel(state: ReturnType<typeof deviceLink>["state"], peer: ServerConnectedPeer) {
  const access = peer.filesCanWrite ? "Can edit" : "Read-only";
  if (state === "connected") return `Connected · ${access}`;
  if (state === "reconnecting") return "Reconnecting";
  if (state === "ended") return peerIsOnline(peer) ? "Session ended · Connect" : "Session ended";
  return peerIsOnline(peer) ? "Connecting" : "Offline";
}
