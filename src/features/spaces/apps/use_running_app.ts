import { useUserStore } from "@/features/account/core";
import { invoke } from "@/native";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  createScreenChannel,
  noteRunningApp,
  useAppControl,
  watchAgentControl,
  type ScreenChannel,
} from "./app_screen";
import { createScreenTools } from "./app_screen_tools";
import { offerAppTools } from "./app_tools";
import { createHostChannel } from "./host_channel";
import type { Authorize, FrameTarget, HostChannel, HostHandlers } from "./host_channel";
import { HostError } from "./protocol";

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
      instance: string;
      start: (frame: FrameTarget, element: HTMLElement, page?: AppPageView) => void;
      leave: () => void;
      save: (file: SavedDownload) => Promise<void>;
    };

const asMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

function refusalOf(error: unknown): HostError {
  if (isRecord(error) && error.denied === true)
    return new HostError("permission_denied", String(error.message ?? "That isn't allowed."));
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Misty couldn't check what the app may do.";
  return new HostError("internal", message);
}

function sessionCheck(session: string): Authorize {
  const grants = new Map<string, Promise<void>>();
  return (kind, name, params) => {
    const asked =
      kind === "subscribe" && name === "room" && isRecord(params) && params.file !== undefined
        ? "room.file"
        : name;
    const key = `${kind}:${asked}`;
    const known = grants.get(key);
    if (known) return known;
    const check = invoke<void>("space_app_session_check", { session, kind, name: asked }).catch(
      (error: unknown) => {
        throw refusalOf(error);
      },
    );
    grants.set(key, check);
    check.catch((error: unknown) => {
      if (!(error instanceof HostError && error.code === "permission_denied"))
        grants.delete(key);
    });
    return check;
  };
}

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
    const leave = () => {
      live = undefined;
      if (alive) setConnected(false);
      channel?.dispose();
      channel = undefined;
      tools?.dispose();
      tools = undefined;
      screen?.dispose();
      screen = undefined;
      unnote?.();
      unnote = undefined;
      if (session) useAppControl.getState().leave(session);
    };
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
      const authorize = sessionCheck(opened);
      const granted = approvedNow.filter((permission) => running.permissions.includes(permission));
      setApp({
        status: "ready",
        manifest: running,
        instance: opened,
        leave,
        async save(file) {
          await authorize("call", "files.save");
          if (!live) throw new Error(`${running.name} isn't connected to Misty yet.`);
          const data = file.data.slice().buffer;
          await live.call("files.save", { name: file.name, mime: file.mime, data });
        },
        start(frame, element, page) {
          leave();
          screen = createScreenChannel(frame, () => useAppControl.getState().takeBack(opened));
          const handle = {
            instance: opened,
            spaceId,
            appId,
            appName: running.name,
            screen,
            frame: () => (element.isConnected ? element : null),
          };
          unnote = noteRunningApp(handle);
          const screenTools = createScreenTools({
            instance: opened,
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
          const base = handlersRef.current({ ...running, permissions: granted });
          const owner = useUserStore.getState().me?.id ?? "";
          channel = createHostChannel({
            frame,
            authorize,
            onActivity: () => setConnected(true),
            handlers: (live = {
              ...base,
              subscribe: (topic, params, emit, end) =>
                topic === "agents.control"
                  ? watchAgentControl(opened, owner, emit)
                  : base.subscribe(topic, params, emit, end),
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
      leave();
      if (session) void invoke("space_app_session_close", { session }).catch(() => {});
    };
  }, [spaceId, appId, version, approvedKey, url, sha256, wrapKey, siteKey, attempt]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);
  return { app, retry, connected };
}
