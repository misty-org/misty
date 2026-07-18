import { useEffect, useState } from "react";
import { Ban, Download, ExternalLink, FolderOpen, Search } from "lucide-react";
import { ActionButton, Field, StatusLine } from "../../shared/pluginChrome";
import { usePluginJob } from "../../shared/usePluginJob";
import type { PluginPanelProps } from "../types";

const outputFormats = [
  { value: "mp3", label: "MP3 audio" }, { value: "m4a", label: "M4A audio" },
  { value: "mp4", label: "MP4 video" }, { value: "webm", label: "WebM video" },
];

type MediaInfo = { title: string; duration?: string; uploader?: string; thumbnail?: string; playlistCount?: number };

export function validWebUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (!(url.protocol === "https:" || url.protocol === "http:") || url.username || url.password) return false;
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || !host.includes(".")) return false;
    if (/^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || host === "::1") return false;
    return true;
  } catch { return false; }
}

export function YtdlpPlugin({ context }: PluginPanelProps) {
  const [url, setUrl] = useState("");
  const [format, setFormat] = useState("mp3");
  const [destination, setDestination] = useState("smart");
  const [playlist, setPlaylist] = useState(false);
  const [dependencies, setDependencies] = useState<{ ytdlp: boolean; ffmpeg: boolean } | null>(null);
  const [dependencyError, setDependencyError] = useState("");
  const [info, setInfo] = useState<MediaInfo | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [inspectionError, setInspectionError] = useState("");
  const jobs = usePluginJob(context);

  useEffect(() => {
    Promise.all([
      context.runHostCommand<{ ok?: boolean; available?: boolean; message?: string }>("dependencies.check", { name: "yt-dlp" }),
      context.runHostCommand<{ ok?: boolean; available?: boolean; message?: string }>("dependencies.check", { name: "ffmpeg" }),
    ]).then(([ytdlp, ffmpeg]) => { setDependencies({ ytdlp: ytdlp.available === true, ffmpeg: ffmpeg.available === true }); setDependencyError(ytdlp.ok === false || ffmpeg.ok === false ? ytdlp.message ?? ffmpeg.message ?? "Open this extension in Misty." : ""); });
  }, [context]);

  async function inspect() {
    setInspectionError(""); setInfo(null);
    if (!validWebUrl(url)) { setInspectionError("Enter a valid http or https video URL."); return; }
    setInspecting(true);
    const result = await context.runHostCommand<{ ok?: boolean; info?: MediaInfo; message?: string }>("ytdlp.inspect", { url, playlist });
    setInspecting(false);
    if (result.ok === false || !result.info) setInspectionError(result.message ?? "Could not read media information.");
    else setInfo(result.info);
  }

  async function startDownload() {
    if (!validWebUrl(url)) { setInspectionError("Enter a valid http or https video URL."); return; }
    await jobs.start("ytdlp.start", { url, format, destination, playlist });
  }

  const ready = dependencies?.ytdlp && dependencies.ffmpeg;
  const status = jobs.job?.error ?? jobs.job?.message ?? (inspectionError || dependencyError || (!dependencies ? "Verifying bundled yt-dlp and FFmpeg…" : !ready ? "The bundled media tools are missing or failed verification. Reinstall this extension." : "Paste a supported media URL, then review it before downloading."));
  const tone = jobs.job?.status === "completed" ? "success" : jobs.job?.status === "failed" || inspectionError ? "error" : "neutral";

  return (
    <div className="panel-stack">
      <div className="panel-title"><h2>yt-dlp</h2><p>Download audio or video through a safe, visible Misty job.</p></div>
      <div className="dependency-row">
        <span className={`dependency-pill ${dependencies?.ytdlp ? "ready" : ""}`}>{dependencies ? dependencies.ytdlp ? "yt-dlp verified" : "yt-dlp unavailable" : "Verifying yt-dlp…"}</span>
        <span className={`dependency-pill ${dependencies?.ffmpeg ? "ready" : ""}`}>{dependencies ? dependencies.ffmpeg ? "FFmpeg verified" : "FFmpeg unavailable" : "Verifying FFmpeg…"}</span>
      </div>
      <Field label="Video or playlist URL"><div className="input-action"><input className="text-input" value={url} onChange={(event) => { setUrl(event.target.value); setInfo(null); setInspectionError(""); }} placeholder="https://www.youtube.com/watch?v=…" inputMode="url" aria-label="Video or playlist URL" disabled={jobs.running} /><ActionButton type="button" className="secondary-button" onClick={() => void inspect()} disabled={!ready || !validWebUrl(url) || inspecting || jobs.running}><Search size={16} aria-hidden="true" />{inspecting ? "Reading…" : "Review"}</ActionButton></div></Field>
      {info ? <section className="media-card">{info.thumbnail ? <img src={info.thumbnail} alt="" /> : <div className="media-placeholder"><ExternalLink size={20} /></div>}<div><strong>{info.title}</strong><span>{[info.uploader, info.duration, info.playlistCount ? `${info.playlistCount} items` : ""].filter(Boolean).join(" · ")}</span></div></section> : null}
      <div className="control-grid">
        <Field label="Output"><select className="select-input" value={format} onChange={(event) => setFormat(event.target.value)} disabled={jobs.running}>{outputFormats.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>
        <Field label="Save to"><select className="select-input" value={destination} onChange={(event) => setDestination(event.target.value)} disabled={jobs.running}><option value="smart">Music or Movies automatically</option><option value="downloads">Downloads</option><option value="music">Music</option><option value="movies">Movies</option></select></Field>
      </div>
      <label className="check-row"><input type="checkbox" checked={playlist} onChange={(event) => { setPlaylist(event.target.checked); setInfo(null); }} disabled={jobs.running} /><span><strong>Allow playlist downloads</strong><small>Off by default to prevent unexpectedly large downloads.</small></span></label>
      {jobs.job?.progress !== null && jobs.running ? <div className="progress-track"><span style={{ width: `${jobs.job?.progress ?? 0}%` }} /></div> : null}
      <StatusLine tone={tone}>{status}</StatusLine>
      <div className="action-row">
        <ActionButton type="button" onClick={() => void startDownload()} disabled={!ready || !validWebUrl(url) || jobs.running}><Download size={16} aria-hidden="true" />{jobs.running ? "Downloading…" : "Start Download"}</ActionButton>
        {jobs.running ? <ActionButton type="button" className="secondary-button" onClick={() => void jobs.cancel()}><Ban size={16} aria-hidden="true" />Cancel</ActionButton> : null}
        {jobs.job?.outputPaths[0] ? <ActionButton type="button" className="secondary-button" onClick={() => void context.runHostCommand("host.revealOutput", { jobId: jobs.job?.id })}><FolderOpen size={16} aria-hidden="true" />Show Output</ActionButton> : null}
      </div>
    </div>
  );
}
