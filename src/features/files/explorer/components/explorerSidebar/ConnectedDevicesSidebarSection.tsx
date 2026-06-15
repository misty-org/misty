import {
  connectedDevicesPrepareClipboardFiles,
  connectedDevicesRoots,
} from "@/features/files/native";
import { SystemErrorActivity } from "@/features/activity";
import {
  Button,
  Collapsible,
  CollapsibleContent,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  TreeBranch,
  cn,
} from "@/shared/ui";
import { ClipboardCopy, Info, MonitorSmartphone, Pencil, Plus, Unlink } from "lucide-react";
import { useState } from "react";
import { ConnectedDevicePairingDialog } from "../../../connected-devices/ConnectedDevicePairingDialog";
import { peerIsOnline, useConnectedDevices } from "@/features/connected-devices";
import { SidebarDeviceGroupHeader, sidebarStyles } from "../ExplorerSidebarSupport";

interface ConnectedDevicesSidebarSectionProps {
  activePath: string;
  onNavigate: (path: string) => void;
}

export function ConnectedDevicesSidebarSection(props: ConnectedDevicesSidebarSectionProps) {
  const connectedDevices = useConnectedDevices();
  const [pairingOpen, setPairingOpen] = useState(false);
  const [networkOpen, setNetworkOpen] = useState(true);

  return (
    <>
      <Collapsible className={sidebarStyles.deviceGroup} open={networkOpen}>
        <SidebarDeviceGroupHeader
          title="Network"
          collapsed={!networkOpen}
          first={false}
          last
          onToggle={() => setNetworkOpen((open) => !open)}
          actions={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Connect another device"
              className={sidebarStyles.deviceGroupAction}
              onClick={() => setPairingOpen(true)}
            >
              <Plus size={13} />
            </Button>
          }
        />
        <CollapsibleContent>
          {connectedDevices.error ? (
            <SystemErrorActivity
              error={connectedDevices.error}
              scope="files:connected-devices"
              title="Connected devices could not be refreshed"
              target={{ kind: "workspace-tool", tool: "files" }}
            />
          ) : null}
          {connectedDevices.loading && connectedDevices.peers.length === 0 ? (
            <div className={sidebarStyles.deviceGroupEmpty}>Finding devices...</div>
          ) : connectedDevices.peers.length === 0 ? (
            <div className={sidebarStyles.deviceGroupEmpty}>No network devices</div>
          ) : (
            <div className={sidebarStyles.list}>
              {connectedDevices.peers.map((peer, index) => {
                const native = connectedDevices.snapshot?.peers.find(
                  (item) => item.deviceId === peer.deviceId,
                );
                const online = peerIsOnline(peer);
                const state = connectionState(native?.state, native?.connectionType, online);
                const selected = props.activePath.startsWith(`misty://device/${peer.deviceId}/`);
                return (
                  <ContextMenu key={peer.pairId}>
                    <ContextMenuTrigger asChild>
                      <div className={sidebarStyles.deviceNestedTreeRow}>
                        <TreeBranch
                          className={sidebarStyles.treeBranch}
                          first={index === 0}
                          last={index === connectedDevices.peers.length - 1}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          className={cn(
                            sidebarStyles.treeSurface,
                            sidebarStyles.deviceButton,
                            selected && sidebarStyles.itemSelected,
                          )}
                          disabled={!online}
                          onClick={() => {
                            void connectedDevicesRoots(peer.deviceId).then((roots) => {
                              const root = roots[0];
                              if (root)
                                props.onNavigate(`misty://device/${peer.deviceId}/${root.id}`);
                            });
                          }}
                        >
                          <span className={sidebarStyles.deviceIcon} aria-hidden="true">
                            <MonitorSmartphone size={24} strokeWidth={1.9} />
                          </span>
                          <span className={sidebarStyles.deviceCopy}>
                            <strong className={sidebarStyles.deviceName}>{peer.name}</strong>
                            <small className={sidebarStyles.deviceMeta}>{state} · Read-only</small>
                          </span>
                        </Button>
                      </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuItem
                        onSelect={() => {
                          const name = window.prompt("Device name", peer.name);
                          if (name) void connectedDevices.renamePeer(peer, name);
                        }}
                      >
                        <Pencil size={15} />
                        <span>Rename</span>
                      </ContextMenuItem>
                      <ContextMenuItem
                        onSelect={() =>
                          void connectedDevices.setClipboardConsent(peer, !peer.clipboardCanSend)
                        }
                      >
                        <ClipboardCopy size={15} />
                        <span>
                          {peer.clipboardCanSend ? "Turn off clipboard" : "Turn on clipboard"}
                        </span>
                      </ContextMenuItem>
                      <ContextMenuItem
                        disabled={!peer.clipboardCanReceive}
                        onSelect={() => void connectedDevicesPrepareClipboardFiles(peer.deviceId)}
                      >
                        <ClipboardCopy size={15} />
                        <span>Prepare clipboard files</span>
                      </ContextMenuItem>
                      <ContextMenuItem
                        onSelect={() => void navigator.clipboard.writeText(peer.p2pEndpointId)}
                      >
                        <Info size={15} />
                        <span>Copy diagnostics ID</span>
                      </ContextMenuItem>
                      <ContextMenuItem onSelect={() => void connectedDevices.unpair(peer)}>
                        <Unlink size={15} />
                        <span>Unpair</span>
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                );
              })}
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
      <ConnectedDevicePairingDialog
        open={pairingOpen}
        onOpenChange={setPairingOpen}
        controller={connectedDevices}
      />
    </>
  );
}

function connectionState(
  state: string | undefined,
  connectionType: "direct" | "relay" | "unknown" | undefined,
  online: boolean,
): string {
  if (state !== "online") return online ? "Connecting" : "Offline";
  if (connectionType === "direct") return "Direct";
  if (connectionType === "relay") return "Relay";
  return "Online";
}
