import { useEffect, useMemo, useState } from "react";
import { Ban, CheckCircle2, FolderOpen, RefreshCw, Wand2 } from "lucide-react";
import { ActionButton, Field, StatusLine } from "../../shared/pluginChrome";
import { usePluginJob } from "../../shared/usePluginJob";
import type { PluginPanelProps } from "../types";

type MediaKind = "image" | "audio" | "video" | "unknown";
const presets: Record<Exclude<MediaKind, "unknown">, string[]> = {
  image: ["png", "jpg", "webp", "avif"],
  audio: ["mp3", "wav", "flac", "m4a"],
  video: ["mp4", "mov", "webm", "gif"],
};
const imageExt = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp", "tiff", "avif", "heic"]);
const audioExt = new Set(["mp3", "wav", "flac", "m4a", "aac", "ogg"]);
const videoExt = new Set(["mp4", "mov", "mkv", "avi", "webm", "m4v"]);

export function mediaKind(path: string): MediaKind {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (imageExt.has(ext)) return "image";
  if (audioExt.has(ext)) return "audio";
  if (videoExt.has(ext)) return "video";
  return "unknown";
}

function fileName(path: string) { return path.split(/[\\/]/).filter(Boolean).pop() ?? path; }

export function QuickConvertPlugin({ context }: PluginPanelProps) {
  const [format, setFormat] = useState("");
  const [quality, setQuality] = useState("balanced");
  const [destination, setDestination] = useState("source");
  const [ffmpegAvailable, setFfmpegAvailable] = useState<boolean | null>(null);
  const [dependencyError, setDependencyError] = useState("");
  const jobs = usePluginJob(context);
  const kinds = context.selectedPaths.map(mediaKind);
  const detected = kinds[0] ?? "unknown";
  const compatible = kinds.length > 0 && kinds.every((kind) => kind === detected) && detected !== "unknown";
  const availablePresets = compatible ? presets[detected as Exclude<MediaKind, "unknown">] : [];
  const effectiveFormat = availablePresets.includes(format) ? format : availablePresets[0] ?? "";
  const selectionLabel = context.selectedPaths.length === 0
    ? "No files selected"
    : context.selectedPaths.length === 1 ? fileName(context.selectedPaths[0]) : `${context.selectedPaths.length} ${detected} files`;
  const outputPreview = useMemo(() => {
    if (context.selectedPaths.length !== 1 || !effectiveFormat) return "";
    const name = fileName(context.selectedPaths[0]);
    const stem = name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name;
    return `${stem}_converted.${effectiveFormat}`;
  }, [context.selectedPaths, effectiveFormat]);

  useEffect(() => {
    void context.runHostCommand<{ ok?: boolean; available?: boolean; message?: string }>("dependencies.check", { name: "ffmpeg" })
      .then((result) => { setFfmpegAvailable(result.available === true); setDependencyError(result.ok === false ? result.message ?? "Open this extension in Misty." : ""); });
  }, [context]);

  const canConvert = compatible && ffmpegAvailable === true && !jobs.running;
  const tone = jobs.job?.status === "completed" ? "success" : jobs.job?.status === "failed" ? "error" : "neutral";
  const status = jobs.job?.error ?? jobs.job?.message ?? (dependencyError || (ffmpegAvailable === false
    ? "The bundled FFmpeg is missing or failed verification. Reinstall this extension."
      : compatible ? (outputPreview ? `Ready to create ${outputPreview}.` : `Ready to convert ${context.selectedPaths.length} files.`)
      : context.selectedPaths.length ? "Select files of one supported media type." : "Select image, audio, or video files in Misty Files."));

  async function convert() {
    await jobs.start("quick_convert.start", {
      paths: context.selectedPaths,
      format: effectiveFormat,
      quality,
      destination,
    });
  }

  return (
    <div className="panel-stack">
      <div className="panel-title"><h2>Quick Convert</h2><p>Make compatible media copies without leaving Files.</p></div>
      <div className="selection-card"><div><span>Selection</span><strong title={context.selectedPaths.join("\n")}>{selectionLabel}</strong></div><span className={`dependency-pill ${ffmpegAvailable ? "ready" : ""}`}>{ffmpegAvailable === null ? "Verifying FFmpeg…" : ffmpegAvailable ? "FFmpeg verified" : "Bundle unavailable"}</span></div>
      <div className="control-grid">
        <Field label="Output format"><select className="select-input" value={effectiveFormat} onChange={(event) => setFormat(event.target.value)} disabled={!compatible || jobs.running}>{availablePresets.length ? availablePresets.map((item) => <option key={item} value={item}>{item.toUpperCase()}</option>) : <option value="">No compatible formats</option>}</select></Field>
        <Field label="Quality"><select className="select-input" value={quality} onChange={(event) => setQuality(event.target.value)} disabled={!compatible || jobs.running}><option value="small">Smaller file</option><option value="balanced">Balanced</option><option value="high">High quality</option></select></Field>
        <Field label="Save to"><select className="select-input" value={destination} onChange={(event) => setDestination(event.target.value)} disabled={jobs.running}><option value="source">Beside originals</option><option value="downloads">Downloads</option></select></Field>
      </div>
      {jobs.job?.progress !== null && jobs.running ? <div className="progress-track" aria-label={`Conversion progress ${Math.round(jobs.job?.progress ?? 0)} percent`}><span style={{ width: `${jobs.job?.progress ?? 0}%` }} /></div> : null}
      <StatusLine tone={tone}>{jobs.job?.status === "completed" ? <CheckCircle2 size={15} aria-hidden="true" /> : null}{status}</StatusLine>
      <div className="action-row">
        <ActionButton type="button" onClick={() => void convert()} disabled={!canConvert}><Wand2 size={16} aria-hidden="true" />{jobs.starting ? "Starting…" : jobs.running ? "Converting…" : "Convert"}</ActionButton>
        {jobs.running ? <ActionButton type="button" className="secondary-button" onClick={() => void jobs.cancel()}><Ban size={16} aria-hidden="true" />Cancel</ActionButton> : null}
        {jobs.job?.outputPaths[0] ? <ActionButton type="button" className="secondary-button" onClick={() => void context.runHostCommand("host.revealOutput", { jobId: jobs.job?.id })}><FolderOpen size={16} aria-hidden="true" />Show Output</ActionButton> : null}
        <ActionButton type="button" className="secondary-button" disabled={jobs.running} onClick={() => { jobs.reset(); void context.refreshSelection(); }}><RefreshCw size={16} aria-hidden="true" />Refresh</ActionButton>
      </div>
    </div>
  );
}
