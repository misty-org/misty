import { AlertTriangle, Files, Sparkles } from "lucide-react";
import type { SmartLibraryImportPreflight } from "../../../api/types";

export function LibraryDropReviewDialog(props: {
  preflight: SmartLibraryImportPreflight;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { preflight } = props;
  return (
    <div className="fixed inset-0 z-[2147483150] grid place-items-center bg-black/70 p-5 backdrop-blur-sm" role="presentation">
      <section className="grid w-[min(480px,94vw)] gap-4 rounded-2xl border border-white/15 bg-[#1b1c20] p-5 text-white shadow-2xl" role="dialog" aria-modal="true" aria-label="Review Library files">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-violet-400/10 text-violet-200"><Sparkles size={19} /></span>
          <div>
            <h3 className="m-0 text-lg font-bold">Review files for Library</h3>
            <p className="m-0 mt-1 text-sm leading-6 text-white/60">Analysis starts only after confirmation. Original files remain in place.</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-xl bg-white/[0.05] p-3"><Files className="mb-2 opacity-60" size={17} /><strong>{preflight.eligibleFiles}</strong><span className="ml-1 text-white/55">eligible</span></div>
          <div className="rounded-xl bg-white/[0.05] p-3"><Sparkles className="mb-2 opacity-60" size={17} /><strong>{preflight.estimate.creditUnits}</strong><span className="ml-1 text-white/55">credit units</span></div>
        </div>
        {preflight.unsupportedFiles > 0 ? <p className="m-0 flex items-center gap-2 rounded-lg bg-amber-400/10 px-3 py-2 text-sm text-amber-100"><AlertTriangle size={15} />{preflight.unsupportedFiles} unsupported file(s) will be skipped.</p> : null}
        <div className="max-h-32 overflow-auto rounded-xl bg-black/20 px-3 py-2 text-xs text-white/60" data-explorer-scroll-container>
          {preflight.fileNames.map((name, index) => <div className="truncate py-0.5" key={`${name}:${index}`}>{name}</div>)}
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" disabled={props.busy} className="h-9 rounded-lg px-3 text-sm font-semibold disabled:opacity-50" onClick={props.onCancel}>Cancel</button>
          <button type="button" disabled={props.busy || preflight.eligibleFiles === 0} className="h-9 rounded-lg bg-white px-4 text-sm font-bold text-black disabled:opacity-50" onClick={props.onConfirm}>{props.busy ? "Starting…" : "Add and analyze"}</button>
        </div>
      </section>
    </div>
  );
}
