import { useEffect, useState } from "react";
import { withBuiltinService } from "@/features/builtin-services";

const firstRetryMs = 30_000;

/**
 * Keeps the packaged app's Files device service attached for this account and reports its
 * instance. Restarts back off exponentially (30s to 5 minutes, jittered) and reset once the
 * service is up, so a broken service is not retried every 30s.
 */
export function useFilesDeviceService(enabled: boolean, accountId: string | undefined) {
  const spaceId = "personal";
  const [deviceInstance, setDeviceInstance] = useState("");
  const [serviceError, setServiceError] = useState("");
  useEffect(() => {
    if (!enabled || !accountId) return;
    const controller = new AbortController();
    let retry: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    setDeviceInstance("");
    const start = async () => {
      let detach = () => {};
      try {
        setServiceError("");
        await withBuiltinService(
          "files",
          spaceId,
          (instance) =>
            new Promise<void>((resolve) => {
              if (controller.signal.aborted) {
                resolve();
                return;
              }
              failures = 0;
              setDeviceInstance(instance);
              const stop = () => resolve();
              controller.signal.addEventListener("abort", stop, { once: true });
              detach = () => {
                controller.signal.removeEventListener("abort", stop);
                resolve();
              };
            }),
          controller.signal,
          "devices",
        );
      } catch (error) {
        if (!controller.signal.aborted) {
          setDeviceInstance("");
          setServiceError(
            error instanceof Error ? error.message : "Files device service is unavailable.",
          );
        }
      } finally {
        detach();
        if (!controller.signal.aborted) {
          const backoff = Math.min(5 * 60_000, firstRetryMs * 2 ** failures++);
          retry = setTimeout(() => void start(), backoff * (0.75 + Math.random() * 0.5));
        }
      }
    };
    void start();
    return () => {
      controller.abort();
      clearTimeout(retry);
    };
  }, [enabled, accountId]);
  return { deviceInstance, serviceError };
}
