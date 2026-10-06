import { useState } from "react";
import { SwitchControl } from "@/features/settings/SettingsControls";
import { controlNativeDevice, readNativeSync } from "./native";
import { useBrowserSyncStore } from "./store";
import { nativeCommandMs, withDeadline } from "./deadline";

/** This device's sync mode (Full sync or Independent workspace), the same
 * control the Sync page shows. Null while sync isn't connected here. */
export function SyncModeControl() {
  const session = useBrowserSyncStore((state) => state.session);
  const [busy, setBusy] = useState(false);
  const device = session?.devices?.find((item) => item.device_id === session.device_id);
  if (!session || !device) return null;
  return (
    <SwitchControl
      checked={device.full_sync}
      disabled={busy || device.control_version < 1}
      onChange={(mode) => {
        setBusy(true);
        void withDeadline(
          controlNativeDevice(session.session_id, device.device_id, mode, false),
          nativeCommandMs,
        )
          .then(() => withDeadline(readNativeSync(), nativeCommandMs))
          .then((latest) => {
            if (latest?.session_id === session.session_id)
              useBrowserSyncStore.setState({ session: latest });
          })
          .catch(() => {})
          .finally(() => setBusy(false));
      }}
    />
  );
}

export function useSyncModeLabel(): string | null {
  const session = useBrowserSyncStore((state) => state.session);
  const device = session?.devices?.find((item) => item.device_id === session.device_id);
  if (!device) return null;
  return device.full_sync
    ? "Share this device’s tabs and website sign-ins."
    : "Independent workspace. Tabs and website sign-ins stay here; account settings still sync.";
}
