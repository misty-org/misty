import { invoke } from "@/native";
import { useCallback, useEffect, useRef, useState } from "react";
import { offerAppTools } from "./appTools";
import { createHostChannel } from "./hostChannel";
import type { HostChannel, HostHandlers } from "./hostChannel";

/** What native reports about an installed app (`AppManifest` in `src-tauri/features/apps/manifest.rs`). */
export interface AppManifest {
  id: string;
  name: string;
  version: string;
  logo: string;
  entry: string;
  opens: string[];
  permissions: string[];
  mcp?: "frame" | "binary";
  webview: boolean;
  own_origin?: boolean;
  inline_scripts?: boolean;
  shim?: boolean;
}

/** Where a version that isn't on this computer comes from: the catalog's address and checksum. */
export interface BundleSource {
  url: string;
  sha256: string;
  /** What Misty adds around a maker's own release; without it the download is a bundle with its own manifest. */
  wrap?: {
    manifest: Record<string, unknown>;
    add_copies: { from: string; to: string }[];
    strip_top: boolean;
  };
}

export type RunningApp =
  | { status: "setup" }
  | { status: "failed"; error: string }
  | { status: "ready"; manifest: AppManifest; start: (frame: Window) => void };

const asMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Gets one version of an app ready to run in a Space: the bundle on this computer (downloaded and checked
 * against the catalog's checksum the first time), then a session native checks every call against. `ready`
 * hands back `start`, which the frame calls when it has loaded to give the app its end of the channel.
 * `makeHandlers` is read through a ref, so a new function each render doesn't restart the app.
 */
export function useRunningApp(options: {
  spaceId: string;
  appId: string;
  version: string;
  /** What a mod approved at install, or `"manifest"` for a built-in app, which gets what its manifest asks. */
  approved: string[] | "manifest";
  source?: BundleSource;
  makeHandlers: (manifest: AppManifest) => HostHandlers;
}): { app: RunningApp; retry: () => void; connected: boolean } {
  const { spaceId, appId, version, source } = options;
  const approvedKey = JSON.stringify(options.approved);
  const handlersRef = useRef(options.makeHandlers);
  handlersRef.current = options.makeHandlers;
  const [app, setApp] = useState<RunningApp>({ status: "setup" });
  const [attempt, setAttempt] = useState(0);
  const [connected, setConnected] = useState(false);
  const url = source?.url;
  const sha256 = source?.sha256;
  const wrapKey = JSON.stringify(source?.wrap ?? null);

  useEffect(() => {
    let live = true;
    let session: string | undefined;
    let channel: HostChannel | undefined;
    let tools: ReturnType<typeof offerAppTools> | undefined;
    setApp({ status: "setup" });
    setConnected(false);

    (async () => {
      let manifest = await invoke<AppManifest | null>("space_app_bundle_manifest", {
        appId,
        version,
      });
      if (!manifest) {
        if (!url || !sha256) throw new Error("This app isn't on this computer yet.");
        manifest = await invoke<AppManifest>("space_app_bundle_install", {
          appId,
          version,
          url,
          sha256,
        });
      }
      if (manifest.webview)
        throw new Error(`${manifest.name} needs a window of its own, which isn't ready yet.`);
      const approvedNow = JSON.parse(approvedKey) as string[] | "manifest";
      const opened = await invoke<string>("space_app_session_open", {
        spaceId,
        appId,
        version,
        approved: approvedNow === "manifest" ? manifest.permissions : approvedNow,
      });
      if (!live) {
        void invoke("space_app_session_close", { session: opened }).catch(() => {});
        return;
      }
      session = opened;
      const running = manifest;
      setApp({
        status: "ready",
        manifest: running,
        start(frame) {
          channel?.dispose();
          tools?.dispose();
          // An app with its own MCP server offers its tools to agents; native gates every call.
          tools = running.mcp === "frame" ? offerAppTools({ appId, session: opened }) : undefined;
          const offered = tools;
          channel = createHostChannel({
            frame,
            authorize: (kind, name) =>
              invoke<void>("space_app_session_check", { session: opened, kind, name }),
            onActivity: () => setConnected(true),
            handlers: {
              ...handlersRef.current(running),
              mcp: offered ? (message) => offered.receive(message) : undefined,
            },
          });
          channel.start();
          offered?.attach(channel, (error) =>
            console.warn(`${running.name}'s tools aren't available:`, error),
          );
        },
      });
    })().catch((error: unknown) => {
      if (live) setApp({ status: "failed", error: asMessage(error) });
    });

    return () => {
      live = false;
      channel?.dispose();
      tools?.dispose();
      if (session) void invoke("space_app_session_close", { session }).catch(() => {});
    };
  }, [spaceId, appId, version, approvedKey, url, sha256, wrapKey, attempt]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);
  return { app, retry, connected };
}
