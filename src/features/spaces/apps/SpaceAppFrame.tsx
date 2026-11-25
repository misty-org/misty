import { SetupState, useNotice } from "@misty/ui";
import { useEffect, useState } from "react";
import { AppPageStage } from "./AppPageStage";
import { useAppControl } from "./app_screen";
import type { HostHandlers } from "./host_channel";
import { useRunningApp } from "./use_running_app";
import type { AppManifest, BundleSource } from "./use_running_app";

const START_TIMEOUT_MS = 30_000;

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
  appName: string;
  version: string;
  approved: string[];
  source?: BundleSource;
  makeHandlers: (manifest: AppManifest) => HostHandlers;
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
  const [channel, setChannel] = useState(true);
  const instance = app.status === "ready" ? app.instance : "";
  const agent = useAppControl((state) => (instance ? state.agents[instance] : undefined));
  const held = useAppControl((state) => Boolean(instance && state.held[instance]));
  useNotice(Boolean(agent && held), {
    message: agent ? `You have control of ${appName}. ${agent.name} is waiting.` : "",
    action: { label: "Hand back", onSelect: () => useAppControl.getState().handBack(instance) },
  });
  const [silent, setSilent] = useState(false);
  const ready = app.status === "ready";
  useEffect(() => {
    setSilent(false);
    if (!ready || connected || !active || !channel) return;
    const timer = window.setTimeout(() => setSilent(true), START_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [ready, connected, active, appId, channel]);

  if (!active) return null;
  if (app.status === "failed")
    return <SetupState tool={appName} named error={app.error} onRetry={retry} />;
  if (silent && !connected)
    return (
      <SetupState
        tool={appName}
        named
        error={`${appName} started but never connected to Misty.`}
        onRetry={() => {
          setSilent(false);
          retry();
        }}
      />
    );
  if (app.status === "setup")
    return <SetupState tool={appName} named stallAfterMs={false} />;
  return (
    <AppPageStage
      key={`${appId}@${version}`}
      spaceId={spaceId}
      appId={appId}
      version={version}
      appName={appName}
      instance={app.instance}
      start={app.start}
      leave={app.leave}
      save={app.save}
      onChannel={setChannel}
    />
  );
}
