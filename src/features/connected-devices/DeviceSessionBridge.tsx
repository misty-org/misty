import { useEffect } from "react";
import { useAuth } from "@/features/auth";
import { ensureDeviceStarted } from "@/features/agents/devices";
import { devicesNative } from "@/native/devices";
import { hasTauriInternals } from "@/shared/platform/tauri";

/**
 * Registers this signed-in session's signing key while an account is signed in, so agents can
 * sign their requests, and closes it on signing out.
 */
export function DeviceSessionBridge() {
  const { user } = useAuth();
  const accountId = user?.id;
  useEffect(() => {
    if (!hasTauriInternals()) return;
    if (accountId) void ensureDeviceStarted().catch(() => undefined);
    else void devicesNative.stop().catch(() => undefined);
  }, [accountId]);
  return null;
}
