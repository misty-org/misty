import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getAppliedAppZoom } from "@/shared/hooks/useAppZoom";
import { physicalToClientPoint } from "@/features/files/explorer/drag/geometry";
import type { MistyFileDropEvent, MistyFileTransferStatus } from "@misty/sdk";
import type { AppRpcScope } from "./session";

/** Native paths are exchanged for short-lived tokens, usable only after a drop into this view. */
export function createFileDropHost(
  scope: AppRpcScope,
  options: {
    root(): HTMLElement | null;
    native(method: string, params?: unknown): Promise<unknown>;
    file<T>(operation: string, params: Record<string, unknown>): Promise<T>;
  },
) {
  const grants = new Map<string, { path: string; confirmed: boolean; expires: number }>();
  const subscriptions = new Set<() => void>();
  const jobs = new Set<string>();
  const close = () => {
    subscriptions.forEach((remove) => remove());
    subscriptions.clear();
    grants.clear();
    jobs.forEach(
      (jobId) => void options.native("files.transferCancel", { jobId }).catch(() => undefined),
    );
  };
  scope.signal.addEventListener("abort", close, { once: true });
  return {
    close,
    async subscribe(listener: (event: MistyFileDropEvent) => void) {
      scope.assert("files.read");
      await options.native("files.sources.list", {});
      const appWindow = getCurrentWindow();
      let scale = await appWindow.scaleFactor(),
        active = false,
        tokens: string[] = [];
      const removeScale = await appWindow.onScaleChanged(({ payload }) => {
        scale = payload.scaleFactor;
      });
      const removeDrag = await getCurrentWebview().onDragDropEvent(({ payload }) => {
        if (scope.signal.aborted) return;
        if (payload.type === "leave") {
          if (active) listener({ type: "leave", position: { x: 0, y: 0 } });
          active = false;
          return;
        }
        const position = physicalToClientPoint(payload.position, scale, getAppliedAppZoom());
        const rect = options.root()?.getBoundingClientRect();
        const inside =
          rect &&
          rect.width > 0 &&
          rect.height > 0 &&
          position.x >= rect.left &&
          position.x <= rect.right &&
          position.y >= rect.top &&
          position.y <= rect.bottom;
        if (payload.type === "enter") {
          for (const [token, grant] of grants)
            if (grant.expires < Date.now() || !grant.confirmed) grants.delete(token);
          tokens = payload.paths.slice(0, 100).map((path) => {
            const token = `misty-drop/${crypto.randomUUID()}/${path.split(/[\\/]/).pop()}`;
            grants.set(token, { path, confirmed: false, expires: Date.now() + 60_000 });
            return token;
          });
        }
        if (!inside) {
          if (active) listener({ type: "leave", position });
          active = false;
          return;
        }
        if (!active) {
          active = true;
          listener({ type: "enter", position, paths: tokens });
        }
        if (payload.type === "drop") {
          const paths = new Set(payload.paths);
          for (const token of tokens) {
            const grant = grants.get(token);
            if (grant && paths.has(grant.path)) grant.confirmed = true;
          }
        }
        listener({ type: payload.type === "enter" ? "over" : payload.type, position });
      });
      const remove = () => {
        removeScale();
        removeDrag();
        subscriptions.delete(remove);
      };
      if (scope.signal.aborted) remove();
      else subscriptions.add(remove);
      return remove;
    },
    async importDrop(tokens: string[], destinationDirectory: string, operation: "copy" | "move") {
      scope.assert("files.write");
      const chosen = tokens.map((token) => {
        const grant = grants.get(token);
        if (!grant?.confirmed || grant.expires < Date.now())
          throw new Error("Drop the files into this view again.");
        return grant;
      });
      for (const token of tokens) grants.delete(token);
      for (const grant of chosen) {
        scope.assert("files.write");
        const isDirectory = await invoke<boolean>("explorer_path_is_directory", {
          path: grant.path,
        });
        const { jobId } = await options.file<{ jobId: string }>("startTransfer", {
          request: {
            sources: [{ path: grant.path, isDirectory, sizeBytes: null, remoteModified: null }],
            destinationDirectory,
            operation,
          },
        });
        jobs.add(jobId);
        try {
          while (true) {
            scope.assert("files.write");
            const status = (await options.native("files.transferStatus", {
              jobId,
            })) as MistyFileTransferStatus;
            if (status.status === "completed") break;
            if (status.status !== "running") throw new Error(status.message);
            await new Promise((resolve) => setTimeout(resolve, 150));
          }
        } finally {
          jobs.delete(jobId);
          await options.native("files.transferClose", { jobId }).catch(() => undefined);
        }
      }
    },
  };
}
