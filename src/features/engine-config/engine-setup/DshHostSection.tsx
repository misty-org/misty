// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong): DshHostSection.tsx,
// DshHostStatusCard.tsx, DshConnectionCard.tsx and useDshHost.ts.
// See NOTICE.

/**
 * DeepSeek Harness in Settings › Channels: its local host, `dsh web`, and how Misty reaches it.
 * A host already running on the address is adopted; otherwise Misty can start one, now or with
 * the app. Its providers and keys live in the host's own web page, not here. Probes run when the
 * page opens and when asked, never on a timer: the host has no push channel.
 */
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useState, type KeyboardEvent } from "react";
import { peekCachedResource, useCachedResource } from "@/api/cache/cached-resource";
import {
  DesktopSettingsRow,
  DesktopSettingsRowSkeleton,
  DesktopSettingsSection as Section,
} from "@/features/settings";
import { Badge, Button, cn, Input, Surface, Switch, Text } from "@/shared/ui";
import { CliUpdateDialog } from "../clis/CliUpdateDialog";
import { useCliUpdateFlow } from "../clis/useCliUpdateFlow";
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

// The neutral dot is the muted text color at half strength.
const DOT: Record<HostState, string> = {
  connected: "bg-emerald-400",
  down: "bg-red-400",
  checking: "bg-current/50",
  starting: "bg-current/50",
  missing: "bg-current/50",
};

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * The host's status, kept for this session so returning to the page shows the last answer at
 * once and probes again behind it. Not saved past the session: a host's state from an earlier
 * run is no guide to this one, and its self-description is the host's own to say.
 */
const DSH_HOST_KEY = "engine-config/dsh-host";

function useDshHostProbe() {
  const resource = useCachedResource(DSH_HOST_KEY, dshHostApi.status);
  const { reload, set } = resource;
  // A failed start or stop, shown until the next good answer.
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
      // Only Misty's own host is ever stopped: confirm against a real probe.
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

/** The host's state, what it runs, and what can be done about it. */
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
  const facts = [describe?.provider, describe?.model].filter(
    (fact): fact is string => typeof fact === "string" && fact.length > 0,
  );
  const recheck = (
    <Button disabled={busy !== null} onClick={() => void probe.refresh(true)}>
      Check again
    </Button>
  );
  return (
    <Surface aria-live="polite" tone="card" edge="hairline" radius="xl" className="grid gap-3 p-3">
      <div className="flex items-center gap-2">
        <Text
          bare
          tone="muted"
          aria-hidden
          className={cn("size-2 shrink-0 rounded-full", DOT[hostState])}
        />
        <Text bare as="p" tone="bright" weight="medium" className="text-sm">
          {TITLES[hostState]}
        </Text>
        {hostState === "connected" || hostState === "down" ? (
          <Text bare as="code" tone="muted" className="text-xs">
            {origin}
          </Text>
        ) : null}
        {status?.ownership === "adopted" ? <Badge variant="outline">Already running</Badge> : null}
      </div>
      {facts.length ? (
        <Text as="p" tone="muted" className="text-xs">
          {facts.join(" · ")}
        </Text>
      ) : null}
      {hostState === "down" && status?.error ? (
        <Text tone="muted" wrap className="text-xs">
          {status.error}
        </Text>
      ) : null}
      <div className="flex items-center justify-end gap-2">
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
        ) : (
          <Button disabled>{TITLES[hostState]}</Button>
        )}
      </div>
    </Surface>
  );
}

/** The DeepSeek Harness host and its connection settings. */
export function DshHostSection() {
  const probe = useDshHostProbe();
  const { settings, save } = useEngineSettings();
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
          <Text role="alert" tone="muted" wrap className="mb-3 text-sm">
            {probe.error}
          </Text>
        ) : null}
        {saveError ? (
          <Text role="alert" tone="muted" wrap className="mb-3 text-sm">
            {saveError}
          </Text>
        ) : null}
        {/* The first probe shows as the card's own Checking state, at the card's real size. */}
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
              <Text full={bin || undefined} tone="muted" className="min-w-0 max-w-55 text-xs">
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
        ) : (
          // The three rows it stands for: the program path's Choose, the address fields and
          // the switch.
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
