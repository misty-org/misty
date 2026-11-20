import { SetupState } from "@misty/ui";
import { useEffect, useRef, useState } from "react";
import { appBundleUrl } from "./appUrl";
import type { HostHandlers } from "./hostChannel";
import { useRunningApp } from "./useRunningApp";
import type { AppManifest, BundleSource } from "./useRunningApp";

const START_TIMEOUT_MS = 8_000;

/**
 * One installed app running in a Space, in a frame with no origin of its own (`allow-scripts` only): the
 * app can't read Misty's storage or reach its pages, and what it may do is the SDK channel, which native
 * checks on every call. The first open downloads the bundle, said as "Setting up …", and later opens use
 * the copy on this computer.
 */
export function SpaceAppFrame({
  spaceId,
  appId,
  appName,
  version,
  approved,
  source,
  makeHandlers,
  active = true,
}: {
  spaceId: string;
  appId: string;
  /** For the setup line, before the app's own manifest has been read. */
  appName: string;
  /** What the Space recorded: a version, or `bundled` for an app Misty ships. */
  version: string;
  approved: string[] | "manifest";
  source?: BundleSource;
  makeHandlers: (manifest: AppManifest) => HostHandlers;
  /** False while the tab is hidden: the frame isn't there then, so the app stops running. */
  active?: boolean;
}) {
  const { app, retry, connected } = useRunningApp({
    spaceId,
    appId,
    version,
    approved,
    source,
    makeHandlers,
  });
  const frame = useRef<HTMLIFrameElement>(null);
  // An app that never calls in (its files blocked, a script failing) would leave a blank frame: say so instead.
  const [silent, setSilent] = useState(false);
  const ready = app.status === "ready";
  useEffect(() => {
    setSilent(false);
    if (!ready || connected || !active) return;
    const timer = window.setTimeout(() => setSilent(true), START_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [ready, connected, active, appId]);

  if (!active) return null;
  if (app.status === "failed")
    return <SetupState tool={appName} error={app.error} onRetry={retry} />;
  if (silent && !connected)
    return (
      <SetupState
        tool={appName}
        error={`${appName} started but never connected to Misty.`}
        onRetry={() => {
          setSilent(false);
          retry();
        }}
      />
    );
  if (app.status === "setup")
    return <SetupState tool={appName} label={`Setting up ${appName}`} stallAfterMs={false} />;
  return (
    <div className="size-full min-h-0">
      <iframe
        ref={frame}
        key={`${appId}@${version}`}
        src={appBundleUrl(appId, version)}
        title={app.manifest.name}
        // An app on its own origin gets storage and downloads, and WebGPU (a secure context); it still has no way to
        // reach Misty but the SDK channel, since that origin is not Misty's.
        sandbox={
          app.manifest.own_origin
            ? "allow-scripts allow-same-origin allow-downloads"
            : "allow-scripts"
        }
        allow={app.manifest.own_origin ? "fullscreen; clipboard-read; clipboard-write" : undefined}
        referrerPolicy="no-referrer"
        className="size-full border-0"
        onLoad={() => {
          if (frame.current?.contentWindow) app.start(frame.current.contentWindow);
        }}
      />
    </div>
  );
}
