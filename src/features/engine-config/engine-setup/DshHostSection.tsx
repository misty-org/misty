// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong): DshHostSection.tsx,
// DshHostStatusCard.tsx, DshConnectionCard.tsx and useDshHost.ts.
// See NOTICE.

import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useState, type KeyboardEvent } from "react";
import { peekCachedResource, useCachedResource } from "@/api/cache/cached_resource";
import {
  DesktopSettingsRow,
  DesktopSettingsRowSkeleton,
  DesktopSettingsSection as Section,
} from "@/features/settings";
import {
  Badge,
  Button,
  ErrorState,
  Input,
  SettingsRow,
  StateMark,
  Switch,
  Text,
  type StateMarkKind,
} from "@misty/ui";
import { CliUpdateDialog } from "../clis/CliUpdateDialog";
import { useCliUpdateFlow } from "../clis/use_cli_update_flow";
import { binKey, dshHostApi, useEngineSettings, type DshHostStatus } from "./api";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3080;

type HostState = "checking" | "starting" | "missing" | "connected" | "down";

const TITLES: Record<HostState, string> = {
  checking: "Checking",
  starting: "Starting",
  missing: "Not installed",
  connected: "Connected",
  down: "Not running",
};

const MARK: Record<HostState, StateMarkKind | null> = {
  connected: "online",
  down: "failed",
  checking: "working",
  starting: "working",
  missing: null,
};

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

const DSH_HOST_KEY = "engine-config/dsh-host";

function useDshHostProbe() {
  const resource = useCachedResource(DSH_HOST_KEY, dshHostApi.status);
  const { reload, set } = resource;
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"checking" | "starting" | "stopping" | null>(null);

  const refresh = useCallback(
    async (manual = false) => {
      if (manual) setBusy("checking");
      try {
        await reload();
        setActionError(null);
      } finally {
        if (manual) setBusy(null);
      }
    },
    [reload],
  );

  const start = useCallback(async () => {
    setBusy("starting");
    try {
      set(await dshHostApi.start());
      setActionError(null);
    } catch (reason) {
      setActionError(errorText(reason));
    } finally {
      setBusy(null);
    }
  }, [set]);

  const stop = useCallback(async () => {
    setBusy("stopping");
    try {
      await dshHostApi.stop();
      const current = peekCachedResource<DshHostStatus>(DSH_HOST_KEY);
      if (current) set({ ...current, running: false, ownership: null, describe: null });
      setActionError(null);
      void refresh();
    } catch (reason) {
      setActionError(errorText(reason));
    } finally {
      setBusy(null);
    }
  }, [refresh, set]);

  const status = resource.data ?? null;
  const error = actionError ?? (resource.error ? errorText(resource.error) : null);
  return { status, error, busy, refresh, start, stop };
}

const commitOnEnter = (commit: () => void) => (event: KeyboardEvent<HTMLInputElement>) => {
  if (event.key === "Enter") {
    event.preventDefault();
    commit();
    event.currentTarget.blur();
  }
};

function HostCard({
  probe,
  hostState,
  origin,
  onInstall,
}: {
  probe: ReturnType<typeof useDshHostProbe>;
  hostState: HostState;
  origin: string;
  onInstall: () => void;
}) {
  const { status, busy } = probe;
  const page = status?.webUrl ?? origin;
  const openPage = () => void openUrl(page).catch(() => undefined);
  const describe = hostState === "connected" ? status?.describe : null;
  const provider = typeof describe?.provider === "string" ? describe.provider : "";
  const model = typeof describe?.model === "string" ? describe.model : "";
  const runsOn = provider && model ? `${model} from ${provider}` : provider || model;
  const mark = MARK[hostState];
  const recheck = (
    <Button disabled={busy !== null} onClick={() => void probe.refresh(true)}>
      Check again
    </Button>
  );
  return (
    <SettingsRow
      aria-live="polite"
      label={TITLES[hostState]}
      description={
        hostState === "down" && status?.error
          ? status.error
          : runsOn || (hostState === "connected" || hostState === "down" ? origin : undefined)
      }
    >
      {status?.ownership === "adopted" ? <Badge variant="outline">Already running</Badge> : null}
      {hostState === "connected" ? (
        <>
          <Button variant="primary" onClick={openPage}>
            Open its page
          </Button>
          {status?.ownership === "spawned" ? (
            <Button disabled={busy !== null} onClick={() => void probe.stop()}>
              Stop
            </Button>
          ) : null}
          {recheck}
        </>
      ) : hostState === "down" ? (
        <>
          <Button variant="primary" disabled={busy !== null} onClick={() => void probe.start()}>
            Start now
          </Button>
          {recheck}
        </>
      ) : hostState === "missing" ? (
        <>
          <Button variant="primary" disabled={busy !== null} onClick={onInstall}>
            Install
          </Button>
          {recheck}
        </>
      ) : null}
      {mark ? <StateMark kind={mark} label={TITLES[hostState]} className="shrink-0" /> : null}
    </SettingsRow>
  );
}

export function DshHostSection() {
  const probe = useDshHostProbe();
  const { settings, loadError, retry, save } = useEngineSettings();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [hostDraft, setHostDraft] = useState<string | null>(null);
  const [portDraft, setPortDraft] = useState<string | null>(null);
  const flow = useCliUpdateFlow("dsh", { onSuccess: () => void probe.refresh() });

  const host = probe.status?.host ?? settings?.dshHost?.trim() ?? DEFAULT_HOST;
  const port = probe.status?.port ?? settings?.dshPort ?? DEFAULT_PORT;
  const origin = probe.status?.origin ?? `http://${host}:${port}`;
  const autoStart = probe.status?.autoStart ?? settings?.dshAutoStart !== false;
  const binField = binKey("dsh");
  const bin =
    typeof settings?.binOverrides?.[binField] === "string"
      ? (settings.binOverrides[binField] as string)
      : "";
  const hostState: HostState =
    probe.busy === "starting"
      ? "starting"
      : probe.status === null && !probe.error
        ? "checking"
        : !probe.status?.installed
          ? "missing"
          : probe.status.running
            ? "connected"
            : "down";

  const apply = async (change: Parameters<typeof save>[0], reprobe = true) => {
    const failed = await save(change);
    setSaveError(failed);
    if (!failed && reprobe) void probe.refresh();
  };

  const commitHost = () => {
    const draft = hostDraft?.trim();
    setHostDraft(null);
    if (!draft || draft === host) return;
    void apply((latest) => ({ ...latest, dshHost: draft }));
  };
  const commitPort = () => {
    const draft = portDraft;
    setPortDraft(null);
    if (!draft) return;
    const value = Number(draft);
    if (!Number.isInteger(value) || value < 1 || value > 65535 || value === port) return;
    void apply((latest) => ({ ...latest, dshPort: value }));
  };
  const chooseBin = async () => {
    const picked = await open({
      multiple: false,
      directory: false,
      title: "DeepSeek Harness program",
    }).catch(() => null);
    if (typeof picked !== "string") return;
    void apply((latest) => ({
      ...latest,
      binOverrides: { ...latest.binOverrides, [binField]: picked },
    }));
  };
  const clearBin = () =>
    void apply((latest) => {
      const binOverrides = { ...latest.binOverrides };
      delete binOverrides[binField];
      return { ...latest, binOverrides };
    });

  return (
    <>
      <Section title="Local host">
        {probe.error ? (
          <Text size="meta" role="alert" tone="muted" wrap className="px-3 py-1.5">
            {probe.error}
          </Text>
        ) : null}
        {saveError ? (
          <Text size="meta" role="alert" tone="muted" wrap className="px-3 py-1.5">
            {saveError}
          </Text>
        ) : null}
        <HostCard
          probe={probe}
          hostState={hostState}
          origin={origin}
          onInstall={() => void flow.begin()}
        />
      </Section>
      <Section title="Connection">
        {settings ? (
          <>
            <DesktopSettingsRow label="Program path">
              <Text size="meta" full={bin || undefined} tone="muted" className="min-w-0 max-w-55">
                {bin || "Found on PATH"}
              </Text>
              <Button onClick={() => void chooseBin()}>Choose</Button>
              {bin ? (
                <Button variant="quiet" onClick={clearBin}>
                  Clear
                </Button>
              ) : null}
            </DesktopSettingsRow>
            <DesktopSettingsRow label="Address">
              <Input
                aria-label="Host"
                className="w-36"
                value={hostDraft ?? host}
                onChange={(event) => setHostDraft(event.target.value)}
                onBlur={commitHost}
                onKeyDown={commitOnEnter(commitHost)}
              />
              <Input
                aria-label="Port"
                className="w-24 text-center"
                inputMode="numeric"
                value={portDraft ?? String(port)}
                onChange={(event) => setPortDraft(event.target.value.replace(/\D/g, ""))}
                onBlur={commitPort}
                onKeyDown={commitOnEnter(commitPort)}
              />
            </DesktopSettingsRow>
            <DesktopSettingsRow label="Start with Misty">
              <Switch
                aria-label="Start with Misty"
                checked={autoStart}
                onCheckedChange={(on) => void apply((latest) => ({ ...latest, dshAutoStart: on }))}
              />
            </DesktopSettingsRow>
          </>
        ) : loadError ? (
          <ErrorState
            inline
            title="Couldn't read the engine's settings"
            line={loadError}
            action={{ label: "Try again", onClick: retry }}
          />
        ) : (
          <>
            <DesktopSettingsRowSkeleton label="Reading the program path" control="button" />
            <DesktopSettingsRowSkeleton label="Reading the address" control="field" />
            <DesktopSettingsRowSkeleton label="Reading Start with Misty" control="switch" />
          </>
        )}
      </Section>
      <CliUpdateDialog engine="dsh" flow={flow} />
    </>
  );
}
