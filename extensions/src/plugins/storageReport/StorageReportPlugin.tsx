import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Ban, FolderSearch, RefreshCw } from "lucide-react";
import { ActionButton, StatusLine } from "../../shared/pluginChrome";
import { usePluginJob } from "../../shared/usePluginJob";
import type { PluginPanelProps } from "../types";

type FileRow = { path: string; name: string; bytes: number; kind: string };
type Report = { root: string; bytes: number; files: number; folders: number; skipped: number; largest: FileRow[]; types: Array<{ kind: string; bytes: number; files: number }> };
const size = (bytes = 0) => new Intl.NumberFormat(undefined, { notation: "compact", style: "unit", unit: "byte", unitDisplay: "narrow", maximumFractionDigits: 1 }).format(bytes);

export function StorageReportPlugin({ context }: PluginPanelProps) {
  const jobs = usePluginJob(context);
  const [sort, setSort] = useState<"bytes" | "name">("bytes");
  const [descending, setDescending] = useState(true);
  const report = jobs.job?.result as Report | undefined;
  const rows = useMemo(() => [...(report?.largest ?? [])].sort((a, b) => {
    const value = sort === "bytes" ? a.bytes - b.bytes : a.name.localeCompare(b.name);
    return descending ? -value : value;
  }), [descending, report, sort]);
  const selected = context.selectedPaths;
  const status = jobs.job?.error ?? jobs.job?.message ?? (selected.length === 1 ? "Ready to scan this folder without following symlinks." : "Select one local folder in Files.");
  const tone = jobs.job?.status === "completed" ? "success" : jobs.job?.status === "failed" ? "error" : "neutral";
  const toggle = (column: "bytes" | "name") => { if (sort === column) setDescending((value) => !value); else { setSort(column); setDescending(column === "bytes"); } };

  return <div className="panel-stack report-panel">
    <header className="panel-title"><h2>Storage Report</h2><p>See what occupies a folder. Read-only, local, and symlink-safe.</p></header>
    <div className="selection-summary"><FolderSearch size={18} /><div><span>Folder</span><strong>{selected[0] ?? "No folder selected"}</strong></div></div>
    {report ? <>
      <dl className="metric-strip"><div><dt>Size</dt><dd>{size(report.bytes)}</dd></div><div><dt>Files</dt><dd>{report.files.toLocaleString()}</dd></div><div><dt>Folders</dt><dd>{report.folders.toLocaleString()}</dd></div><div><dt>Skipped</dt><dd>{report.skipped.toLocaleString()}</dd></div></dl>
      <section className="utility-section"><div className="section-heading"><h3>Largest files</h3><span>{rows.length} shown</span></div><div className="file-table" role="table" aria-label="Largest files"><div className="file-row file-head" role="row"><button onClick={() => toggle("name")} type="button">Name {sort === "name" ? descending ? <ArrowDown /> : <ArrowUp /> : null}</button><button onClick={() => toggle("bytes")} type="button">Size {sort === "bytes" ? descending ? <ArrowDown /> : <ArrowUp /> : null}</button></div>{rows.map((row) => <div className="file-row" role="row" key={row.path}><span title={row.path}>{row.name}</span><strong>{size(row.bytes)}</strong></div>)}</div></section>
      <section className="utility-section"><div className="section-heading"><h3>File types</h3></div><div className="distribution-list">{report.types.map((item) => <div key={item.kind}><span>{item.kind}</span><i><b style={{ width: `${Math.max(2, report.bytes ? item.bytes / report.bytes * 100 : 0)}%` }} /></i><strong>{size(item.bytes)} · {item.files}</strong></div>)}</div></section>
    </> : null}
    {jobs.running && jobs.job?.progress != null ? <div className="progress-track" aria-label={`${jobs.job.progress}% scanned`}><span style={{ width: `${jobs.job.progress}%` }} /></div> : null}
    <StatusLine tone={tone}>{status}</StatusLine>
    <div className="action-row"><ActionButton type="button" disabled={selected.length !== 1 || jobs.running} onClick={() => void jobs.start("storage_report.start", { root: selected[0] })}>{report ? <RefreshCw size={16} /> : <FolderSearch size={16} />}{report ? "Refresh report" : "Scan folder"}</ActionButton>{jobs.running ? <ActionButton className="secondary-button" type="button" onClick={() => void jobs.cancel()}><Ban size={16} />Cancel</ActionButton> : null}</div>
  </div>;
}
