import { useEffect, useRef, useState } from "react";
import { Ban, FolderOpen, Image, Sparkles } from "lucide-react";
import { ActionButton, Field, StatusLine } from "../../shared/pluginChrome";
import { connectMistyApp, type MistyAppSDK, type MistyFileHandle } from "@misty/sdk";
import { optimizeImages, supportedImagePath, type OptimizeOptions, type OptimizeResult } from "./optimizeImages";
export { supportedImagePath } from "./optimizeImages";
const size = (bytes = 0) => new Intl.NumberFormat(undefined, { notation: "compact", style: "unit", unit: "byte", unitDisplay: "narrow", maximumFractionDigits: 1 }).format(bytes);

export function ImageOptimizerPlugin() {
  const sdk = useRef<MistyAppSDK | null>(null);
  const alive = useRef(false);
  const operation = useRef<AbortController | null>(null);
  const [files, setFiles] = useState<MistyFileHandle[]>([]);
  const [folder, setFolder] = useState<{ handle: string; name: string } | null>(null);
  const [quality, setQuality] = useState<OptimizeOptions["quality"]>("balanced");
  const [dimension, setDimension] = useState("original");
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Choose images, then choose where to save the copies.");
  const [result, setResult] = useState<OptimizeResult | null>(null);
  useEffect(() => {
    alive.current = true;
    try { sdk.current = connectMistyApp(); } catch (error) { setError(String(error)); }
    return () => { alive.current = false; operation.current?.abort(); };
  }, []);
  const pick = async (output: boolean) => {
    if (!sdk.current || busy || running) return;
    setBusy(true); setError("");
    try {
      if (output) { const selected = await sdk.current.files.pickDirectory({ write: true }); if (alive.current && selected) { if (folder) void sdk.current.files.release(folder.handle).catch(() => undefined); setFolder(selected); } }
      else { const selected = await sdk.current.files.pickMany(); if (alive.current && selected.length) { files.forEach(file => void sdk.current!.files.release(file.handle).catch(() => undefined)); setFiles(selected); setResult(null); } }
    } catch (error) { if (alive.current) setError(String(error)); }
    finally { if (alive.current) setBusy(false); }
  };
  const start = async () => {
    if (!sdk.current || !folder || busy || running) return;
    const abort = new AbortController(); operation.current = abort;
    setRunning(true); setError(""); setResult(null); setStatus("Optimizing images…");
    try {
      const done = await optimizeImages(sdk.current, files, folder.handle, { quality, maxDimension: dimension === "original" ? null : Number(dimension) }, abort.signal, value => {
        if (alive.current) { setResult(value); setStatus(`Processed ${value.files.length} of ${files.length} images.`); }
      });
      if (alive.current) setStatus(`Saved ${done.files.filter(file => file.status === "completed").length} copies in ${folder.name}. Originals were kept.`);
    } catch (error) {
      if (alive.current) { if (abort.signal.aborted) setStatus("Cancelled. Copies already saved were kept."); else setError(String(error)); }
    } finally { operation.current = null; if (alive.current) setRunning(false); }
  };
  const valid = files.length > 0 && files.length <= 64 && files.every(file => supportedImagePath(file.name));
  return <div className="panel-stack optimizer-panel">
    <header className="panel-title"><h2>Image Optimizer</h2><p>Create smaller JPEG, PNG, and WebP copies. Originals stay unchanged.</p></header>
    <div className="selection-summary"><Image size={18} /><div><span>Images</span><strong>{files.length ? `${files.length} selected` : "No images chosen"}</strong>{files.length && !valid ? <small>Choose up to 64 JPEG, PNG, or WebP images.</small> : null}</div></div>
    <div className="action-row"><ActionButton type="button" className="secondary-button" disabled={busy || running} onClick={() => void pick(false)}><Image size={16} />Choose images</ActionButton><ActionButton type="button" className="secondary-button" disabled={busy || running} onClick={() => void pick(true)}><FolderOpen size={16} />Choose output folder</ActionButton></div>
    <p>Save copies in: <strong>{folder?.name ?? "Choose a folder"}</strong></p>
    <div className="control-grid"><Field label="Quality" hint="Balanced works well for most photos."><select className="select-input" value={quality} onChange={event => setQuality(event.target.value as OptimizeOptions["quality"])} disabled={running}><option value="small">Smaller files</option><option value="balanced">Balanced</option><option value="high">Higher quality</option></select></Field><Field label="Maximum dimension"><select className="select-input" value={dimension} onChange={event => setDimension(event.target.value)} disabled={running}><option value="original">Keep original</option>{[3840,2560,1920,1280].map(value => <option key={value} value={value}>{value} px</option>)}</select></Field></div>
    <div className="naming-note"><strong>Output naming</strong><span>photo.jpg → photo_optimized.jpg; existing files are never replaced. If no smaller encoding is available, the original bytes are copied.</span></div>
    {result ? <section className="utility-section"><div className="section-heading"><h3>Results</h3><strong>{size(Math.max(0,result.originalBytes-result.outputBytes))} saved</strong></div><div className="outcome-list">{result.files.map((file,index) => <div key={index}><span>{file.source}</span><strong className={file.status === "completed" ? "success-text" : "danger-text"}>{file.status === "completed" ? `${file.output} · ${size(file.outputBytes)}` : file.message}</strong></div>)}</div></section> : null}
    {running ? <div className="progress-track"><span style={{ width: `${(result?.files.length ?? 0)/files.length*100}%` }} /></div> : null}
    <StatusLine tone={error ? "error" : "neutral"}>{error || status}</StatusLine>
    <div className="action-row"><ActionButton type="button" disabled={!valid || !folder || busy || running} onClick={() => void start()}><Sparkles size={16} />{running ? "Optimizing…" : "Optimize copies"}</ActionButton>{running ? <ActionButton type="button" className="secondary-button" onClick={() => operation.current?.abort()}><Ban size={16} />Cancel</ActionButton> : null}</div>
  </div>;
}
