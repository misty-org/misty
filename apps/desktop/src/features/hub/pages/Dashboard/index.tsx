import { invoke } from "@tauri-apps/api/core";
import {
  Activity,
  Bug,
  ClipboardList,
  FileText,
  MonitorDot,
  RefreshCw,
  Server,
  TerminalSquare,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type LogKey = "misty-hub" | "misty" | "misty-proxy" | "misty-rclone";

type LogFileSnapshot = {
  name: string;
  path: string;
  exists: boolean;
  size_bytes: number;
  content: string;
};

type ClipboardDevice = {
  device_id: string;
  device_name: string;
  last_seen_unix_ms: number;
  online: boolean;
};

type ClipboardPayload = {
  payload_id: string;
  kind: string;
  source_device_id: string;
  source_device_name: string;
  revision: number;
  created_unix_ms: number;
  text: string;
  file_refs: Array<unknown>;
};

type ClipboardProxySnapshot = {
  proxy_running: boolean;
  proxy_url: string | null;
  devices: ClipboardDevice[];
  latest: ClipboardPayload | null;
  error: string | null;
};

const logs: Array<{
  key: LogKey;
  label: string;
  description: string;
  icon: typeof Activity;
}> = [
  {
    key: "misty-hub",
    label: "Misty Hub",
    description: "Installer, auth, launch, and dashboard host events.",
    icon: Activity,
  },
  {
    key: "misty",
    label: "Misty",
    description: "File manager startup, view routing, and app diagnostics.",
    icon: TerminalSquare,
  },
  {
    key: "misty-proxy",
    label: "Misty Proxy",
    description: "Local API, auth middleware, remote operations, and transfer service.",
    icon: Server,
  },
  {
    key: "misty-rclone",
    label: "Misty Rclone",
    description: "Managed rclone daemon stdout and stderr.",
    icon: Bug,
  },
];

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

function browserFallback(name: LogKey): LogFileSnapshot {
  return {
    name: `${name}.log`,
    path: `~/.misty/logs/${name}.log`,
    exists: false,
    size_bytes: 0,
    content: "Log inspection is available in the Misty Hub desktop app.",
  };
}

function formatTime(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return "Never";
  }
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function latestLabel(payload: ClipboardPayload | null) {
  if (!payload) {
    return "No shared clipboard";
  }
  if (payload.kind === "text") {
    const text = payload.text.trim();
    return text ? text : "Empty text clipboard";
  }
  return `${payload.file_refs.length} file ref${payload.file_refs.length === 1 ? "" : "s"}`;
}

export default function DashboardPage() {
  const [activeLog, setActiveLog] = useState<LogKey>("misty-hub");
  const [snapshots, setSnapshots] = useState<Partial<Record<LogKey, LogFileSnapshot>>>({});
  const [clipboard, setClipboard] = useState<ClipboardProxySnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const activeMeta = useMemo(
    () => logs.find((log) => log.key === activeLog) ?? logs[0],
    [activeLog],
  );
  const activeSnapshot = snapshots[activeLog];

  async function loadLog(name: LogKey) {
    try {
      const snapshot = await invoke<LogFileSnapshot>("read_misty_log", {
        name,
        maxBytes: 512 * 1024,
      });
      setSnapshots((current) => ({ ...current, [name]: snapshot }));
      setError("");
    } catch (requestError) {
      const message = String(requestError);
      if (message.toLowerCase().includes("invoke")) {
        setSnapshots((current) => ({ ...current, [name]: browserFallback(name) }));
        setError("");
        return;
      }
      setError(message);
    }
  }

  async function refreshAll() {
    setLoading(true);
    try {
      await Promise.all([
        ...logs.map((log) => loadLog(log.key)),
        invoke<ClipboardProxySnapshot>("get_clipboard_proxy_snapshot")
          .then((snapshot) => setClipboard(snapshot))
          .catch((requestError) => {
            const message = String(requestError);
            setClipboard({
              proxy_running: false,
              proxy_url: null,
              devices: [],
              latest: null,
              error: message.toLowerCase().includes("invoke")
                ? "Clipboard relay state is available in the Misty Hub desktop app."
                : message,
            });
          }),
      ]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshAll();
  }, []);

  const ActiveIcon = activeMeta.icon;
  const lines = activeSnapshot?.content
    ? activeSnapshot.content.split("\n").filter(Boolean).length
    : 0;

  return (
    <div className="mx-auto flex h-screen w-full max-w-[1400px] flex-col px-5 py-4">
      <div className="flex items-center justify-between gap-4 border-b border-white/[0.07] pb-4">
        <div>
          <h1 className="text-[34px] font-semibold tracking-[-0.03em] text-text">
            Dashboard
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            Runtime logs for Misty, Hub, Proxy, and Rclone.
          </p>
        </div>
        <button
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-text transition hover:border-white/20 hover:bg-white/[0.08] disabled:opacity-60"
          disabled={loading}
          onClick={() => void refreshAll()}
          type="button"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      <section className="grid gap-3 border-b border-white/[0.07] py-4 md:grid-cols-[220px_minmax(0,1fr)_280px]">
        <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.06] text-text">
              <Server className="h-5 w-5" />
            </span>
            <div>
              <p className="text-xs text-text-muted">Clipboard Relay</p>
              <p className="text-sm font-semibold text-text">
                {clipboard?.proxy_running ? "Proxy online" : "Proxy stopped"}
              </p>
            </div>
          </div>
          <p className="mt-3 truncate text-xs text-text-muted">
            {clipboard?.proxy_url ?? "No local proxy port"}
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.06] text-text">
                <ClipboardList className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="text-xs text-text-muted">Latest Shared</p>
                <p className="truncate text-sm font-semibold text-text">
                  {latestLabel(clipboard?.latest ?? null)}
                </p>
              </div>
            </div>
            <span className="shrink-0 text-xs text-text-muted">
              rev {clipboard?.latest?.revision ?? 0}
            </span>
          </div>
          <p className="mt-3 truncate text-xs text-text-muted">
            {clipboard?.latest
              ? `${clipboard.latest.source_device_name || clipboard.latest.source_device_id} at ${formatTime(
                  clipboard.latest.created_unix_ms,
                )}`
              : clipboard?.error ?? "Publish from Misty to populate shared clipboard state."}
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.06] text-text">
                <MonitorDot className="h-5 w-5" />
              </span>
              <div>
                <p className="text-xs text-text-muted">Devices</p>
                <p className="text-sm font-semibold text-text">
                  {clipboard?.devices.length ?? 0} registered
                </p>
              </div>
            </div>
          </div>
          <div className="space-y-1">
            {(clipboard?.devices ?? []).slice(0, 3).map((device) => (
              <div className="flex items-center justify-between gap-3 text-xs" key={device.device_id}>
                <span className="truncate text-text">{device.device_name}</span>
                <span className="shrink-0 text-text-muted">{formatTime(device.last_seen_unix_ms)}</span>
              </div>
            ))}
            {clipboard && clipboard.devices.length === 0 ? (
              <p className="text-xs text-text-muted">No registered devices yet.</p>
            ) : null}
          </div>
        </div>
      </section>

      <section className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)] gap-4 py-4">
        <aside className="flex min-h-0 flex-col gap-2 overflow-y-auto border-r border-white/[0.07] pr-4">
          {logs.map(({ description, icon: Icon, key, label }) => {
            const snapshot = snapshots[key];
            const selected = key === activeLog;
            return (
              <button
                className={`rounded-2xl border p-4 text-left transition ${
                  selected
                    ? "border-white/18 bg-white/[0.08] text-text"
                    : "border-white/8 bg-white/[0.025] text-text-muted hover:border-white/14 hover:bg-white/[0.05] hover:text-text"
                }`}
                key={key}
                onClick={() => setActiveLog(key)}
                type="button"
              >
                <span className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.06]">
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{label}</span>
                    <span className="block text-xs text-text-muted">
                      {snapshot?.exists ? formatBytes(snapshot.size_bytes) : "No file yet"}
                    </span>
                  </span>
                </span>
                <span className="mt-3 block text-xs leading-5 text-text-muted">
                  {description}
                </span>
              </button>
            );
          })}
        </aside>

        <div className="flex min-h-0 flex-col overflow-hidden rounded-[1.5rem] border border-white/10 bg-[#0a0d10]/95 shadow-2xl shadow-black/25">
          <div className="flex items-center justify-between gap-4 border-b border-white/[0.07] px-5 py-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.06] text-text">
                <ActiveIcon className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold text-text">
                  {activeSnapshot?.name ?? `${activeLog}.log`}
                </h2>
                <p className="truncate text-xs text-text-muted">
                  {activeSnapshot?.path ?? `~/.misty/logs/${activeLog}.log`}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-3 text-xs text-text-muted">
              <span>{activeSnapshot?.exists ? formatBytes(activeSnapshot.size_bytes) : "Missing"}</span>
              <span className="h-1 w-1 rounded-full bg-white/25" />
              <span>{lines} lines</span>
            </div>
          </div>

          {error ? (
            <div className="m-5 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {error}
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-auto bg-[#050608] p-5">
            {activeSnapshot?.content ? (
              <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-[#e7e1d8]">
                {activeSnapshot.content}
              </pre>
            ) : (
              <div className="flex h-full items-center justify-center text-center text-sm text-text-muted">
                <div>
                  <FileText className="mx-auto mb-3 h-8 w-8 opacity-70" />
                  <p>No log output yet.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
