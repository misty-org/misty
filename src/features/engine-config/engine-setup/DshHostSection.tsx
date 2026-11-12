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
import { useCallback, useEffect, useState, type KeyboardEvent } from "react";
import { DesktopSettingsRow, DesktopSettingsSection as Section } from "@/features/settings";
import { Button, cn, Input, Skeleton, Switch, OverflowFadeText } from "@/shared/ui";
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

const DOT: Record<HostState, string> = {
  connected: "bg-emerald-400",
  down: "bg-red-400",
  checking: "bg-cream-muted/50",
  starting: "bg-cream-muted/50",
  missing: "bg-cream-muted/50",
};

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

function useDshHostProbe() {
  const [status, setStatus] = useState<DshHostStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"checking" | "starting" | "stopping" | null>(null);

  const refresh = useCallback(async (manual = false) => {
    if (manual) setBusy("checking");
    try {
      setStatus(await dshHostApi.status());
      setError(null);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      if (manual) setBusy(null);
    }
  }, []);

  const start = useCallback(async () => {
    setBusy("starting");
    try {
      setStatus(await dshHostApi.start());
      setError(null);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(null);
    }
  }, []);

  const stop = useCallback(async () => {
    setBusy("stopping");
    try {
      await dshHostApi.stop();
      setStatus((current) =>
        current ? { ...current, running: false, ownership: null, describe: null } : current,
      );
      setError(null);
      // Only Misty's own host is ever stopped: confirm against a real probe.
      void refresh();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(null);
    }
  }, [refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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
    <div
      aria-live="polite"
      className="grid gap-3 rounded-xl border border-charcoal-border bg-charcoal-card/40 p-3"
    >
      <div className="flex items-center gap-2">
        <span aria-hidden className={cn("size-2 shrink-0 rounded-full", DOT[hostState])} />
        <p className="text-sm font-medium text-cream-bright">{TITLES[hostState]}</p>
        {hostState === "connected" || hostState === "down" ? (
          <code className="text-xs text-cream-muted">{origin}</code>
        ) : null}
        {status?.ownership === "adopted" ? (
          <span className="rounded-sm border border-cream/10 bg-charcoal-hover px-1.5 text-micro text-cream-muted">
            Already running
          </span>
        ) : null}
      </div>
      {facts.length ? <p className="text-xs text-cream-muted">{facts.join(" · ")}</p> : null}
      {hostState === "down" && status?.error ? (
        <p className="text-xs text-cream-muted">{status.error}</p>
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
    </div>
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
          <p role="alert" className="mb-3 text-sm text-cream-muted">
            {probe.error}
          </p>
        ) : null}
        {saveError ? (
          <p role="alert" className="mb-3 text-sm text-cream-muted">
            {saveError}
          </p>
        ) : null}
        {hostState === "checking" ? (
          <Skeleton className="h-[92px] w-full rounded-xl" />
        ) : (
          <HostCard
            probe={probe}
            hostState={hostState}
            origin={origin}
            onInstall={() => void flow.begin()}
          />
        )}
      </Section>
      <Section title="Connection">
        {settings ? (
          <>
            <DesktopSettingsRow label="Program path">
              <OverflowFadeText
                full={bin || undefined}
                className="min-w-0 max-w-[220px] font-mono text-xs text-cream-muted"
              >
                {bin || "Found on PATH"}
              </OverflowFadeText>
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
          <div className="grid gap-3 py-3" aria-label="Reading the connection">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-6 w-1/2" />
          </div>
        )}
      </Section>
      <CliUpdateDialog engine="dsh" flow={flow} />
    </>
  );
}
