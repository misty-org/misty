import { SystemErrorActivity } from "@/features/activity";
import { IconButton } from "@/shared/ui";
import { Plus } from "lucide-react";
import { useState } from "react";
import { ConnectedDevicePairingDialog, useConnectedDevices } from "@/features/connected-devices";
import { SidebarDeviceGroup, sidebarStyles } from "@/features/file-ui";
import { ConnectedDeviceRow } from "./ConnectedDeviceRow";

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
      <SidebarDeviceGroup
        title="Network"
        open={networkOpen}
        onOpenChange={setNetworkOpen}
        actions={
          <IconButton
            size="xs"
            tooltip={false}
            label="Connect another device"
            className={sidebarStyles.deviceGroupAction}
            onClick={() => setPairingOpen(true)}
          >
            <Plus size={13} />
          </IconButton>
        }
      >
        {connectedDevices.error ? (
          <SystemErrorActivity
            error={connectedDevices.error}
            scope="files:connected-devices"
            intent="background"
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
            {connectedDevices.peers.map((peer) => (
              <ConnectedDeviceRow
                key={peer.pairId}
                peer={peer}
                controller={connectedDevices}
                activePath={props.activePath}
                onNavigate={props.onNavigate}
              />
            ))}
          </div>
        )}
      </SidebarDeviceGroup>
      <ConnectedDevicePairingDialog
        open={pairingOpen}
        onOpenChange={setPairingOpen}
        controller={connectedDevices}
      />
    </>
  );
}
