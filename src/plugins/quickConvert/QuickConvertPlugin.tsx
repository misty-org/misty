import { useMemo, useState } from "react";
import { RefreshCw, Wand2 } from "lucide-react";
import { ActionButton, Field, StatusLine } from "../../shared/pluginChrome";
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

function mediaKind(path: string): MediaKind {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (imageExt.has(ext)) return "image";
  if (audioExt.has(ext)) return "audio";
  if (videoExt.has(ext)) return "video";
  return "unknown";
}

function fileName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

export function QuickConvertPlugin({ context }: PluginPanelProps) {
  const selectedPath = context.selectedPaths[0] ?? "";
  const detected = mediaKind(selectedPath);
  const availablePresets = detected === "unknown" ? [] : presets[detected];
  const [format, setFormat] = useState("png");
  const [status, setStatus] = useState("Select a media file in Misty Files to enable conversion presets.");
  const [tone, setTone] = useState<"neutral" | "success" | "error">("neutral");
  const effectiveFormat = availablePresets.includes(format) ? format : availablePresets[0] ?? format;

  const outputName = useMemo(() => {
    if (!selectedPath || !effectiveFormat) return "";
    const name = fileName(selectedPath);
    const stem = name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name;
    return `${stem}_converted.${effectiveFormat}`;
  }, [effectiveFormat, selectedPath]);

  async function convert() {
    if (!selectedPath || detected === "unknown") {
      setTone("error");
      setStatus("Select a supported image, audio, or video file first.");
      context.notify("error", "Quick Convert", "Select a supported media file first.");
      return;
    }

    const result = await context.runHostCommand<{ ok?: boolean; message?: string }>(
      "quick_convert.convert",
      { path: selectedPath, format: effectiveFormat },
    );
    const ok = result.ok !== false;
    setTone(ok ? "success" : "error");
    setStatus(result.message ?? (ok ? `Requested conversion to ${outputName}.` : "The host bridge could not start conversion."));
    context.notify(ok ? "success" : "error", "Quick Convert", result.message ?? `Requested ${effectiveFormat.toUpperCase()} conversion.`);
  }

  return (
    <div className="panel-stack">
      <div className="panel-title">
        <h2>Quick Convert</h2>
        <p>Convert the currently selected file using Misty's web plugin bridge.</p>
      </div>

      <div className="control-grid">
        <Field label="Detected type">
          <input className="text-input" value={detected} readOnly />
        </Field>
        <Field label="Output format">
          <select
            className="select-input"
            value={effectiveFormat}
            onChange={(event) => setFormat(event.target.value)}
            disabled={availablePresets.length === 0}
          >
            {availablePresets.length === 0 ? (
              <option value="">No presets</option>
            ) : availablePresets.map((preset) => (
              <option key={preset} value={preset}>{preset.toUpperCase()}</option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Selected file">
        <input className="text-input" value={selectedPath || "No file selected"} readOnly />
      </Field>

      <StatusLine tone={tone}>
        {outputName ? `Output preview: ${outputName}` : status}
      </StatusLine>

      <div className="action-row">
        <ActionButton type="button" onClick={convert} disabled={!selectedPath || detected === "unknown"}>
          <Wand2 size={16} aria-hidden="true" />
          Convert
        </ActionButton>
        <ActionButton
          type="button"
          className="secondary-button"
          onClick={() => {
            setTone("neutral");
            setStatus("Selection refreshed from Misty.");
          }}
        >
          <RefreshCw size={16} aria-hidden="true" />
          Reset status
        </ActionButton>
      </div>

      <StatusLine tone={tone}>{status}</StatusLine>
    </div>
  );
}
