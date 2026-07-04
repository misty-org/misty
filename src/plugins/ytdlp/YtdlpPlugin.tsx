import { useState } from "react";
import { Download, FolderOpen } from "lucide-react";
import { ActionButton, Field, StatusLine } from "../../shared/pluginChrome";
import type { PluginPanelProps } from "../types";

const outputFormats = [
  { value: "mp3", label: "MP3" },
  { value: "m4a", label: "M4A" },
  { value: "mp4", label: "MP4" },
  { value: "webm", label: "WEBM" },
];

const destinations = [
  { value: "smart", label: "Smart" },
  { value: "downloads", label: "Downloads" },
  { value: "music", label: "Music" },
  { value: "movies", label: "Movies" },
];

export function YtdlpPlugin({ context }: PluginPanelProps) {
  const [url, setUrl] = useState("");
  const [format, setFormat] = useState("mp3");
  const [destination, setDestination] = useState("smart");
  const [playlist, setPlaylist] = useState(false);
  const [status, setStatus] = useState("Paste a YouTube URL to get started.");
  const [tone, setTone] = useState<"neutral" | "success" | "error">("neutral");

  async function startDownload() {
    if (!url.trim()) {
      setTone("error");
      setStatus("Paste a video or playlist URL first.");
      context.notify("error", "yt-dlp", "Paste a video or playlist URL first.");
      return;
    }

    const result = await context.runHostCommand<{ ok?: boolean; message?: string }>(
      "ytdlp.download",
      { url, format, destination, playlist },
    );
    const ok = result.ok !== false;
    setTone(ok ? "success" : "error");
    setStatus(result.message ?? (ok ? "Download job requested." : "Downloads require the Misty host bridge."));
    context.notify(ok ? "success" : "error", "yt-dlp", result.message ?? "Download job requested.");
  }

  return (
    <div className="panel-stack">
      <div className="panel-title">
        <h2>yt-dlp</h2>
        <p>Prepare video, playlist, and audio extraction jobs from Misty.</p>
      </div>

      <Field label="Video or playlist URL">
        <input
          className="text-input"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://www.youtube.com/watch?v=..."
        />
      </Field>

      <div className="control-grid">
        <Field label="Output format">
          <select className="select-input" value={format} onChange={(event) => setFormat(event.target.value)}>
            {outputFormats.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Destination">
          <select className="select-input" value={destination} onChange={(event) => setDestination(event.target.value)}>
            {destinations.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </Field>
      </div>

      <label className="inline-flex items-center gap-2 text-sm text-zinc-200">
        <input
          type="checkbox"
          checked={playlist}
          onChange={(event) => setPlaylist(event.target.checked)}
        />
        Allow playlist downloads
      </label>

      <div className="action-row">
        <ActionButton type="button" onClick={startDownload}>
          <Download size={16} aria-hidden="true" />
          Start Download
        </ActionButton>
        <ActionButton
          type="button"
          className="secondary-button"
          onClick={() => context.runHostCommand("ytdlp.openOutputFolder", { destination })}
        >
          <FolderOpen size={16} aria-hidden="true" />
          Open Output
        </ActionButton>
      </div>

      <StatusLine tone={tone}>{status}</StatusLine>
    </div>
  );
}
