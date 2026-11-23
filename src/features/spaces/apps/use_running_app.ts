import { invoke } from "@/native";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  createScreenChannel,
  noteRunningApp,
  useAppControl,
  type ScreenChannel,
} from "./app_screen";
import { createScreenTools } from "./app_screen_tools";
import { offerAppTools } from "./app_tools";
import { createHostChannel } from "./host_channel";
import type { FrameTarget, HostChannel, HostHandlers } from "./host_channel";

export interface AppManifest {
  id: string;
  name: string;
  version: string;
  logo: string;
  entry: string;
  opens: string[];
  permissions: string[];
  mcp?: "frame" | "binary" | "adapter";
  webview: boolean;
  own_origin?: boolean;
  inline_scripts?: boolean;
  shim?: boolean;
  license?: string;
  platforms?: ("macos" | "windows" | "linux")[];
  network?: { host: string; paid?: boolean }[];
  collab?: "room";
  adapter?: string;
}

export interface BundleSource {
  url: string;
  sha256: string;
  wrap?: {
    manifest: Record<string, unknown>;
    add_copies: { from: string; to: string }[];
    strip_top: boolean;
    auto_top?: boolean;
    add_files?: { path: string; content: string }[];
  };
}

export interface AppPageView {
  snapshot(): Promise<{ dataUrl: string; width: number; height: number }>;
}

export interface SavedDownload {
  name: string;
  mime: string;
  data: Uint8Array;
}

export type RunningApp =
  | { status: "setup" }
  | { status: "failed"; error: string }
  | {
      status: "ready";
      manifest: AppManifest;
      start: (frame: FrameTarget, element: HTMLElement, page?: AppPageView) => void;
      save: (file: SavedDownload) => Promise<void>;
    };

const asMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function useRunningApp(options: {
  spaceId: string;
  appId: string;
  version: string;
  approved: string[];
  source?: BundleSource;
  site?: AppManifest;
  makeHandlers: (manifest: AppManifest) => HostHandlers;
}): { app: RunningApp; retry: () => void; connected: boolean } {
  const { spaceId, appId, version, source } = options;
  const siteKey = options.site ? JSON.stringify(options.site) : "";
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
    let alive = true;
    let session: string | undefined;
    let channel: HostChannel | undefined;
    let tools: ReturnType<typeof offerAppTools> | undefined;
    let screen: ScreenChannel | undefined;
    let unnote: (() => void) | undefined;
    let live: HostHandlers | undefined;
    setApp({ status: "setup" });
    setConnected(false);

    (async () => {
      let manifest = siteKey
        ? (JSON.parse(siteKey) as AppManifest)
        : await invoke<AppManifest | null>("space_app_bundle_manifest", { appId, version });
      if (!manifest) {
        if (!url || !sha256) throw new Error("This app isn't on this computer yet.");
        manifest = await invoke<AppManifest>("space_app_bundle_install", {
          appId,
          version,
          url,
          sha256,
          wrap: JSON.parse(wrapKey) as BundleSource["wrap"] | null,
        });
      }
      if (manifest.webview)
        throw new Error(`${manifest.name} needs a window of its own, which isn't ready yet.`);
      const approvedNow = JSON.parse(approvedKey) as string[];
      const opened = await invoke<string>("space_app_session_open", {
        spaceId,
        appId,
        version,
        approved: approvedNow,
      });
      if (!alive) {
        void invoke("space_app_session_close", { session: opened }).catch(() => {});
        return;
      }
      session = opened;
      const running = manifest;
      setApp({
        status: "ready",
        manifest: running,
        async save(file) {
          await invoke<void>("space_app_session_check", {
            session: opened,
            kind: "call",
            name: "files.save",
          });
          if (!live) throw new Error(`${running.name} isn't connected to Misty yet.`);
          const data = file.data.slice().buffer;
          await live.call("files.save", { name: file.name, mime: file.mime, data });
        },
        start(frame, element, page) {
          channel?.dispose();
          tools?.dispose();
          screen?.dispose();
          screen = createScreenChannel(frame, () => useAppControl.getState().takeBack(appId));
          unnote?.();
          const handle = {
            appId,
            appName: running.name,
            screen,
            frame: () => (element.isConnected ? element : null),
          };
          unnote = noteRunningApp(handle);
          const screenTools = createScreenTools({
            appId,
            appName: running.name,
            screen,
            frame: () => (element.isConnected ? element : null),
            snapshot: page ? () => page.snapshot() : undefined,
          });
          tools = offerAppTools({
            appId,
            session: opened,
            mcp: running.mcp === "frame",
            adapter: running.mcp === "adapter" ? screen : undefined,
            extra: screenTools,
          });
          const offered = tools;
          channel = createHostChannel({
            frame,
            authorize: (kind, name) =>
              invoke<void>("space_app_session_check", { session: opened, kind, name }),
            onActivity: () => setConnected(true),
            handlers: (live = {
              ...handlersRef.current(running),
              mcp: running.mcp === "frame" ? (message) => offered.receive(message) : undefined,
            }),
          });
          channel.start();
          offered.attach(channel, (error) =>
            console.warn(`${running.name}'s tools aren't available:`, error),
          );
        },
      });
    })().catch((error: unknown) => {
      if (alive) setApp({ status: "failed", error: asMessage(error) });
    });

    return () => {
      alive = false;
      live = undefined;
      channel?.dispose();
      tools?.dispose();
      screen?.dispose();
      unnote?.();
      useAppControl.getState().leave(appId);
      if (session) void invoke("space_app_session_close", { session }).catch(() => {});
    };
  }, [spaceId, appId, version, approvedKey, url, sha256, wrapKey, siteKey, attempt]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);
  return { app, retry, connected };
}
