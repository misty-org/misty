import { useEffect } from "react";
import type { MistyAppSDK, MistySurfaceAdapter } from "@misty/sdk";

export function useSDKSurfaceRegistration({
  misty,
  adapter,
  report,
}: {
  misty: MistyAppSDK;
  adapter: MistySurfaceAdapter | null;
  report(error: unknown): void;
}) {
  useEffect(() => {
    if (!adapter) return;
    let closed = false,
      remove: (() => void) | undefined;
    void misty.surfaces
      .register(adapter)
      .then((cleanup) => {
        if (closed) cleanup();
        else remove = cleanup;
      })
      .catch(report);
    return () => {
      closed = true;
      remove?.();
    };
  }, [misty, adapter, report]);
}

export function SDKSurfaceRegistration(props: Parameters<typeof useSDKSurfaceRegistration>[0]) {
  useSDKSurfaceRegistration(props);
  return null;
}
