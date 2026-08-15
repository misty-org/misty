import { Ban, FolderOpen, Image, Sparkles } from "lucide-react";
import { ActionButton, Field, StatusLine } from "../../shared/pluginChrome";
import { usePluginJob } from "../../shared/usePluginJob";
import type { PluginPanelProps } from "../types";

type OptimizeResult = { originalBytes: number; outputBytes: number; files: Array<{ source: string; output?: string; originalBytes: number; outputBytes?: number; status: string; message?: string }> };
export const supportedImagePath = (path: string) => /\.(jpe?g|png|webp)$/i.test(path);
const size = (bytes = 0) => new Intl.NumberFormat(undefined, { notation: "compact", style: "unit", unit: "byte", unitDisplay: "narrow", maximumFractionDigits: 1 }).format(bytes);

export function ImageOptimizerPlugin({ context }: PluginPanelProps) {
  const jobs = usePluginJob(context);
  const selected = context.selectedPaths.filter(supportedImagePath);
  const invalid = context.selectedPaths.length - selected.length;
  const result = jobs.job?.result as OptimizeResult | undefined;
  const status = jobs.job?.error ?? jobs.job?.message ?? (!selected.length ? "Select JPEG, PNG, or WebP files in Files." : selected.length > 64 ? "Choose no more than 64 images." : `${selected.length} image${selected.length === 1 ? "" : "s"} ready. Originals will never be changed.`);
  const savings = result ? Math.max(0, result.originalBytes - result.outputBytes) : 0;
  return <div className="panel-stack optimizer-panel">
    <header className="panel-title"><h2>Image Optimizer</h2><p>Smaller images with sensible controls and source-safe output.</p></header>
    <div className="selection-summary"><Image size={18} /><div><span>Selection</span><strong>{selected.length ? `${selected.length} supported image${selected.length === 1 ? "" : "s"}` : "No supported images"}</strong>{invalid ? <small>{invalid} unsupported item{invalid === 1 ? "" : "s"} excluded</small> : null}</div></div>
    <div className="control-grid"><Field label="Quality" hint="Balanced works well for most photos."><select className="select-input" id="optimizer-quality" defaultValue="balanced" disabled={jobs.running}><option value="small">Smaller files</option><option value="balanced">Balanced</option><option value="high">Higher quality</option></select></Field><Field label="Maximum dimension"><select className="select-input" id="optimizer-dimension" defaultValue="original" disabled={jobs.running}><option value="original">Keep original</option><option value="3840">3840 px</option><option value="2560">2560 px</option><option value="1920">1920 px</option><option value="1280">1280 px</option></select></Field><Field label="Save copies to"><select className="select-input" id="optimizer-destination" defaultValue="beside" disabled={jobs.running}><option value="beside">Beside originals</option><option value="downloads">Downloads</option></select></Field></div>
    <div className="naming-note"><strong>Output naming</strong><span>photo.jpg → photo_optimized.jpg; collisions receive a number.</span></div>
    {result ? <section className="utility-section"><div className="section-heading"><h3>Results</h3><strong>{size(savings)} saved</strong></div><div className="outcome-list">{result.files.map((file) => <div key={file.source}><span title={file.source}>{file.source.split(/[\\/]/).pop()}</span><strong className={file.status === "completed" ? "success-text" : "danger-text"}>{file.status === "completed" ? `${size((file.originalBytes ?? 0) - (file.outputBytes ?? 0))} saved` : file.message ?? "Failed"}</strong></div>)}</div></section> : null}
    {jobs.running && jobs.job?.progress != null ? <div className="progress-track"><span style={{ width: `${jobs.job.progress}%` }} /></div> : null}
    <StatusLine tone={jobs.job?.status === "completed" ? "success" : jobs.job?.status === "failed" ? "error" : "neutral"}>{status}</StatusLine>
    <div className="action-row"><ActionButton type="button" disabled={!selected.length || selected.length > 64 || jobs.running} onClick={() => void jobs.start("image_optimizer.start", { paths: selected, quality: (document.querySelector("#optimizer-quality") as HTMLSelectElement)?.value, maxDimension: (document.querySelector("#optimizer-dimension") as HTMLSelectElement)?.value, destination: (document.querySelector("#optimizer-destination") as HTMLSelectElement)?.value })}><Sparkles size={16} />{jobs.running ? "Optimizing…" : "Optimize copies"}</ActionButton>{jobs.running ? <ActionButton type="button" className="secondary-button" onClick={() => void jobs.cancel()}><Ban size={16} />Cancel</ActionButton> : null}{jobs.job?.outputPaths?.length ? <ActionButton type="button" className="secondary-button" onClick={() => void context.runHostCommand("host.revealOutput", { jobId: jobs.job?.id })}><FolderOpen size={16} />Show output</ActionButton> : null}</div>
  </div>;
}
