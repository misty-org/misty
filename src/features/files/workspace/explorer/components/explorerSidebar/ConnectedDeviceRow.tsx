import {
  connectedDevicesPrepareClipboardFiles,
  connectedDevicesRoots,
  connectedDevicesSnapshot,
} from "../../../native";
import { reportSystemError } from "@/features/activity";
import {
  deviceStatusLabel,
  type DevicePeer,
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
import { ClipboardPaste, Info, Link2, MonitorSmartphone, Pencil } from "lucide-react";
import { useState } from "react";
import { sidebarStyles } from "@/features/file-ui";

type Controller = ReturnType<typeof useConnectedDevices>;

const connectWaitMs = 15_000;

/** Waits for a direct LAN connection after a connect request. */
async function waitForConnection(deviceId: string): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < connectWaitMs) {
    const snapshot = await connectedDevicesSnapshot().catch(() => null);
    if (snapshot?.peers.some((peer) => peer.deviceId === deviceId)) return true;
    await new Promise((resolve) => window.setTimeout(resolve, 400));
  }
  return false;
}

export function ConnectedDeviceRow(props: {
  peer: DevicePeer;
  controller: Controller;
  activePath: string;
  onNavigate: (path: string) => void;
}) {
  const { peer, controller } = props;
  const [busy, setBusy] = useState(false);
  const canOpen = peer.online && peer.policy?.files !== "off";
  const selected = props.activePath.startsWith(`misty://device/${peer.id}/`);

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
      if (!peer.connected) {
        await controller.connect(peer.id);
        if (!(await waitForConnection(peer.id)))
          throw new Error(`${peer.name} isn't reachable on this network.`);
      }
      const roots = await connectedDevicesRoots(peer.id);
      // The system disk first; volumes follow it.
      const root = roots.find((item) => item.kind === "system") ?? roots[0];
      if (root) props.onNavigate(`misty://device/${peer.id}/${root.id}`);
    });

  const access =
    peer.policy?.files === "edit"
      ? "Can edit"
      : peer.policy?.files === "off"
        ? "Not shared"
        : "View";

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
              <small className={sidebarStyles.deviceMeta}>
                {deviceStatusLabel(peer.status)}
                {peer.online ? ` · ${access}` : ""}
              </small>
            </span>
          </Button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuAction
          icon={<Link2 size={15} />}
          label="Connect"
          disabled={!peer.online || peer.connected}
          onSelect={() =>
            void run(`Couldn't connect ${peer.name}`, () => controller.connect(peer.id))
          }
        />
        <ContextMenuAction
          icon={<ClipboardPaste size={15} />}
          label="Prepare copied files for other apps"
          disabled={!peer.policy?.clipboard || !peer.connected}
          onSelect={() =>
            void run("Couldn't prepare the copied files", () =>
              connectedDevicesPrepareClipboardFiles(peer.id),
            )
          }
        />
        <ContextMenuAction
          icon={<Pencil size={15} />}
          label="Rename"
          onSelect={() => {
            const name = window.prompt("Device name", peer.name);
            if (name?.trim())
              void run("Couldn't rename the device", () => controller.rename(peer.id, name.trim()));
          }}
        />
        <ContextMenuAction
          icon={<Info size={15} />}
          label="Copy diagnostics ID"
          onSelect={() => void navigator.clipboard.writeText(peer.p2pEndpointId ?? peer.id)}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}
