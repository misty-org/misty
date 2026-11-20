import { LivePointer, SetupState, useNotice } from "@misty/ui";
import { useEffect, useRef, useState } from "react";
import { personTone } from "@/features/agents";
import { useAppControl } from "./appScreen";
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
  /** The version the Space added. */
  version: string;
  /** What a mod approved when the app was added. */
  approved: string[];
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
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const agent = useAppControl((state) => state.agents[appId]);
  const held = useAppControl((state) => Boolean(state.held[appId]));
  // The person's own click or key in the app took control back: the agent waits until they hand it back.
  useNotice(Boolean(agent && held), {
    message: agent ? `You have control of ${appName}. ${agent.name} is waiting.` : "",
    action: { label: "Hand back", onSelect: () => useAppControl.getState().handBack(appId) },
  });
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height }),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [app.status]);
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
    <div ref={box} className="relative size-full min-h-0">
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
          if (frame.current?.contentWindow) app.start(frame.current.contentWindow, frame.current);
        }}
      />
      {size && agent ? (
        // The agent working in the app, where it last acted: its pointer, never the person's own.
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
          <LivePointer
            name={agent.name}
            tone={personTone(agent.agentId)}
            left={agent.x * size.width}
            top={agent.y * size.height}
          />
        </div>
      ) : null}
    </div>
  );
}
