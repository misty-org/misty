import { useEffect, useRef, useState } from "react";
import { Ban, Download, ExternalLink, FolderOpen, Search } from "lucide-react";
import {
  connectMistyApp,
  type MistyAppSDK,
  type MistyDownloadJob,
} from "@misty/sdk";
import { ActionButton, Field, StatusLine } from "../../shared/pluginChrome";

const outputFormats = [
  { value: "mp3", label: "MP3 audio" },
  { value: "m4a", label: "M4A audio" },
  { value: "mp4", label: "MP4 video" },
  { value: "webm", label: "WebM video" },
] as const;

type MediaInfo = {
  title: string;
  duration?: string;
  uploader?: string;
  playlistCount?: number;
};
type Folder = { handle: string; name: string };

export function validWebUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443"))
      return false;
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
    if (!host.includes(".")) return false;
    if (
      /^(127\.|10\.|192\.168\.|169\.254\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|172\.(1[6-9]|2\d|3[01])\.)/.test(
        host,
      )
    )
      return false;
    return true;
  } catch {
    return false;
  }
}

export function YtdlpPlugin() {
  const sdk = useRef<MistyAppSDK | null>(null);
  const alive = useRef(true);
  const currentJob = useRef("");
  const folderRef = useRef<Folder | null>(null);
  const [url, setUrl] = useState("");
  const [format, setFormat] = useState<"mp3" | "m4a" | "mp4" | "webm">("mp3");
  const [playlist, setPlaylist] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [folder, setFolder] = useState<Folder | null>(null);
  const [info, setInfo] = useState<MediaInfo | null>(null);
  const [outputs, setOutputs] = useState<readonly { name: string; bytes: number }[]>([]);
  const [message, setMessage] = useState("Checking the restricted media service…");
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  folderRef.current = folder;

  useEffect(() => {
    alive.current = true;
    try {
      sdk.current = connectMistyApp();
      void sdk.current.downloads.status().then(
        (status) => {
          if (!alive.current) return;
          setAvailable(status.available);
          setMessage(
            status.available
              ? "Paste a supported public HTTPS media URL, then review it before downloading."
              : (status.message ?? "Media downloads are unavailable on this device."),
          );
        },
        (caught) => alive.current && setError(String(caught)),
      );
    } catch (caught) {
      setError(String(caught));
    }
    return () => {
      alive.current = false;
      if (currentJob.current)
        void sdk.current?.downloads.jobCancel(currentJob.current).catch(() => undefined);
      if (folderRef.current)
        void sdk.current?.files.release(folderRef.current.handle).catch(() => undefined);
    };
  }, []);

  const run = async (start: () => Promise<{ jobId: string }>) => {
    if (!sdk.current || running) return null;
    setRunning(true);
    setError("");
    let jobId = "";
    try {
      jobId = (await start()).jobId;
      currentJob.current = jobId;
      let state: MistyDownloadJob;
      for (;;) {
        state = await sdk.current.downloads.jobStatus(jobId);
        setMessage(state.message);
        if (state.status !== "running") break;
        await new Promise((resolve) => window.setTimeout(resolve, 300));
        if (!alive.current || currentJob.current !== jobId)
          throw new Error("Media operation cancelled.");
      }
      if (state.status !== "completed") throw new Error(state.message);
      return state.result ?? null;
    } catch (caught) {
      if (alive.current) setError(String(caught));
      return null;
    } finally {
      if (jobId) void sdk.current?.downloads.jobClose(jobId).catch(() => undefined);
      if (currentJob.current === jobId) currentJob.current = "";
      if (alive.current) setRunning(false);
    }
  };

  const inspect = async () => {
    setInfo(null);
    setOutputs([]);
    if (!validWebUrl(url)) {
      setError("Enter a public HTTPS media URL.");
      return;
    }
    const result = await run(() => sdk.current!.downloads.inspectStart(url, playlist));
    if (result?.title && alive.current) {
      setInfo({
        title: result.title,
        uploader: result.uploader,
        duration: result.duration,
        playlistCount: result.playlistCount,
      });
      setMessage("Media details reviewed. Choose a folder before downloading.");
    }
  };

  const chooseFolder = async () => {
    if (!sdk.current || running) return;
    const chosen = await sdk.current.files.pickDirectory({ write: true });
    if (!chosen || !alive.current) return;
    if (folder) await sdk.current.files.release(folder.handle).catch(() => undefined);
    setFolder(chosen);
  };

  const download = async () => {
    if (!folder || !validWebUrl(url)) return;
    setOutputs([]);
    const result = await run(() =>
      sdk.current!.downloads.downloadStart({
        url,
        format,
        playlist,
        directory: folder.handle,
      }),
    );
    if (result?.outputs && alive.current) {
      setOutputs(result.outputs);
      setMessage(
        `${result.outputs.length} file${result.outputs.length === 1 ? "" : "s"} saved in ${folder.name}.`,
      );
    }
  };

  return (
    <div className="panel-stack">
      <div className="panel-title">
        <h2>yt-dlp</h2>
        <p>Download media through Misty’s restricted public-network service.</p>
      </div>
      <div className="dependency-row">
        <span className={`dependency-pill ${available ? "ready" : ""}`}>
          {available === null
            ? "Checking media service…"
            : available
              ? "Restricted service ready"
              : "Media service unavailable"}
        </span>
      </div>
      <Field label="Video or playlist URL">
        <div className="input-action">
          <input
            className="text-input"
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
              setInfo(null);
              setOutputs([]);
              setError("");
            }}
            placeholder="https://www.youtube.com/watch?v=…"
            inputMode="url"
            aria-label="Video or playlist URL"
            disabled={running}
          />
          <ActionButton
            type="button"
            className="secondary-button"
            onClick={() => void inspect()}
            disabled={!available || !validWebUrl(url) || running}
          >
            <Search size={16} aria-hidden="true" />
            Review
          </ActionButton>
        </div>
      </Field>
      {info ? (
        <section className="media-card">
          <div className="media-placeholder">
            <ExternalLink size={20} />
          </div>
          <div>
            <strong>{info.title}</strong>
            <span>
              {[info.uploader, info.duration, info.playlistCount ? `${info.playlistCount} items` : ""]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>
        </section>
      ) : null}
      <div className="control-grid">
        <Field label="Output">
          <select
            className="select-input"
            value={format}
            onChange={(event) => setFormat(event.target.value as typeof format)}
            disabled={running}
          >
            {outputFormats.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Save to">
          <ActionButton
            type="button"
            className="secondary-button"
            disabled={running}
            onClick={() => void chooseFolder()}
          >
            <FolderOpen size={16} />
            {folder?.name ?? "Choose folder…"}
          </ActionButton>
        </Field>
      </div>
      <label className="check-row">
        <input
          type="checkbox"
          checked={playlist}
          onChange={(event) => {
            setPlaylist(event.target.checked);
            setInfo(null);
          }}
          disabled={running}
        />
        <span>
          <strong>Allow playlist downloads</strong>
          <small>Off by default. Playlists are limited to 100 items and 10 GB of traffic.</small>
        </span>
      </label>
      {outputs.length ? (
        <div className="source-box">
          <strong>Saved files</strong>
          <span>{outputs.map((output) => output.name).join(", ")}</span>
        </div>
      ) : null}
      <StatusLine tone={error ? "error" : outputs.length ? "success" : "neutral"}>
        {error || message}
      </StatusLine>
      <div className="action-row">
        <ActionButton
          type="button"
          onClick={() => void download()}
          disabled={!available || !info || !folder || running}
        >
          <Download size={16} aria-hidden="true" />
          {running ? "Working…" : "Start Download"}
        </ActionButton>
        {running ? (
          <ActionButton
            type="button"
            className="secondary-button"
            onClick={() => {
              if (currentJob.current)
                void sdk.current?.downloads.jobCancel(currentJob.current);
            }}
          >
            <Ban size={16} aria-hidden="true" />
            Cancel
          </ActionButton>
        ) : null}
      </div>
    </div>
  );
}
