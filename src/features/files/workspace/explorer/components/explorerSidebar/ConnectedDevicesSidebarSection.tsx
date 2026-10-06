import { SystemErrorActivity } from "@/features/activity";
import { Skeleton } from "@/shared/ui";
import { useState } from "react";
import { useConnectedDevices } from "@/features/connected-devices";
import { SidebarDeviceGroup, sidebarStyles } from "@/features/file-ui";
import { ConnectedDeviceRow } from "./ConnectedDeviceRow";

interface ConnectedDevicesSidebarSectionProps {
  activePath: string;
  onNavigate: (path: string) => void;
}

/** The account's other devices for browsing over the LAN. Adding a device
 * happens once, in Settings → Devices; there is no pairing here. */
export function ConnectedDevicesSidebarSection(props: ConnectedDevicesSidebarSectionProps) {
  const connectedDevices = useConnectedDevices();
  const [networkOpen, setNetworkOpen] = useState(true);
  const others = connectedDevices.peers.filter((peer) => !peer.isSelf);

  return (
    <SidebarDeviceGroup title="Network" open={networkOpen} onOpenChange={setNetworkOpen}>
      {connectedDevices.error ? (
        <SystemErrorActivity
          error={connectedDevices.error}
          scope="files:connected-devices"
          intent="background"
          title="Your devices could not be refreshed"
          target={{ kind: "workspace-tool", tool: "files" }}
        />
      ) : null}
      {connectedDevices.loading && others.length === 0 ? (
        <div className={sidebarStyles.deviceGroupEmpty} aria-hidden="true">
          <Skeleton className="h-4 w-32" />
        </div>
      ) : others.length === 0 ? (
        <div className={sidebarStyles.deviceGroupEmpty}>
          {connectedDevices.view?.admitted
            ? "Add your other devices from their Settings."
            : "Add this device in Settings → Devices"}
        </div>
      ) : (
        <div className={sidebarStyles.list}>
          {others.map((peer) => (
            <ConnectedDeviceRow
              key={peer.id}
              peer={peer}
              controller={connectedDevices}
              activePath={props.activePath}
              onNavigate={props.onNavigate}
            />
          ))}
        </div>
      )}
    </SidebarDeviceGroup>
  );
}
