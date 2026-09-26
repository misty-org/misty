import { useState } from "react";
import { useUserStore } from "@/features/auth/core";
import { DesktopSettingsRow as SettingsRow } from "@/features/settings/desktop";
import { TextControl } from "@/features/settings/settingsControls";
import { deviceRows } from "./deviceControl";
import { readNativeSync, renameNativeDevice, type NativeSyncView } from "./native";
import { useBrowserSyncStore } from "./store";

/** One name field per device on the account. Empty keeps the default name. */
export function DeviceNameSettings({ session }: { session: NativeSyncView }) {
  const ownerName = useUserStore((state) => state.me?.name);
  const [error, setError] = useState<string | null>(null);
  const rows = deviceRows(session, ownerName);
  const rename = async (deviceId: string, name: string) => {
    setError(null);
    if (!name.trim()) return;
    try {
      await renameNativeDevice(session.session_id, deviceId, name);
      const latest = await readNativeSync();
      if (latest?.session_id === session.session_id)
        useBrowserSyncStore.setState({ session: latest });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };
  return (
    <>
      {rows.map((row, index) => (
        <SettingsRow
          key={row.device_id}
          label={row.local ? `${row.name} (this device)` : row.name}
          last={index === rows.length - 1 && !error}
        >
          <TextControl
            value={row.display_name}
            placeholder={row.name}
            disabled={session.status.phase !== "ready" && session.status.phase !== "catching_up"}
            onCommit={(value) => void rename(row.device_id, value)}
          />
        </SettingsRow>
      ))}
      {error && (
        <p role="alert" className="px-5 py-3 text-sm text-destructive">
          {error}
        </p>
      )}
    </>
  );
}
