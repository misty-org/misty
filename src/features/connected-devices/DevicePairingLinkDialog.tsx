import { useConnectedDevices } from "./ConnectedDevicesProvider";
import { subscribeDevicePairingLinks, takeDevicePairingLink } from "./pairingLinks";
import { useEffect, useState } from "react";
import { ConnectedDevicePairingDialog } from "./ConnectedDevicePairingDialog";

/** Opens the pairing dialog for a misty://devices/pair link, wherever the user is in Misty. */
export function DevicePairingLinkDialog() {
  const controller = useConnectedDevices();
  const [link, setLink] = useState<string | null>(null);
  useEffect(() => {
    const take = () => {
      const next = takeDevicePairingLink();
      if (next) setLink(next);
    };
    take();
    return subscribeDevicePairingLinks(take);
  }, []);
  return (
    <ConnectedDevicePairingDialog
      open={link !== null}
      link={link ?? undefined}
      controller={controller}
      onOpenChange={(open) => {
        if (!open) setLink(null);
      }}
    />
  );
}
