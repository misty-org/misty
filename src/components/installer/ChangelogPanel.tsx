import { CheckCircle2 } from "lucide-react";
import { useSetupStore } from "../../stores/useSetupStore";

export function ChangelogPanel() {
  const selectedVersion = useSetupStore((state) => state.selectedVersion);
  const releases = useSetupStore((state) => state.releases);
  const release = releases.find((entry) => entry.version === selectedVersion) ?? releases[0];

  if (!release) return null;

  return (
    <section className="rounded-xl border border-[#1e1e21] bg-[#0b0d0f]">
      <div className="sticky top-0 border-b border-[#1e1e21] bg-[#0b0d0f]/95 px-4 py-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-bold text-white">{release.version}</h2>
            <p className="mt-1 truncate text-sm text-[#a1a1aa]">{release.summary}</p>
          </div>
          <span className="shrink-0 rounded-md border border-[#27272a] px-2 py-1 font-mono text-xs text-[#d4d4d8]">
            {release.date}
          </span>
        </div>
      </div>

      <div className="grid gap-2 p-3">
        {release.changes.map((change) => (
          <div
            className="flex items-start gap-3 rounded-lg border border-[#1e1e21] bg-[#07090b] px-3 py-3 text-sm text-[#d4d4d8]"
            key={change}
          >
            <CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
            <span className="min-w-0 leading-5">{change}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
