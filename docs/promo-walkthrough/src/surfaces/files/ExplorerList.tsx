import { cn } from "@/shared/ui";
import { ChevronUp, FileSearch, FileText, Folder, Image } from "lucide-react";
import { devices, studioFiles } from "../../data/project";
import type { FilesState } from "../../film/state";
import { Notebooks } from "../browser/sites/Staging";

type Entry = { name: string; modified: string; size: string; kind: string; folder?: boolean };

const folder = (name: string, modified: string): Entry => ({ name, modified, size: "-", kind: "Folder", folder: true });

export function listingFor(state: FilesState): Entry[] {
  switch (state.location) {
    case "home":
      return ["Applications", "Desktop", "Documents", "Downloads", "Movies", "Music", "Pictures"].map((name, index) =>
        folder(name, ["Sep 2", "Oct 1", "Today", "Oct 1", "Sep 12", "Aug 23", "Sep 29"][index]),
      );
    case "studio":
      return [folder("Website launch", "Today"), folder("Photography", "Sep 26"), folder("Archive", "Aug 14")];
    case "studio-launch":
      return studioFiles.map((file) => ({ ...file }));
    case "documents-launch":
      return [
        { name: "Launch brief.md", modified: "Oct 2", size: "3 KB", kind: "Markdown" },
        { name: "Sitemap.md", modified: "Sep 30", size: "2 KB", kind: "Markdown" },
        ...(state.pasted ? [{ name: "hero-photo.jpg", modified: "Today", size: "8.4 MB", kind: "Image" }] : []),
      ];
  }
}

function EntryIcon({ entry }: { entry: Entry }) {
  if (entry.folder) return <Folder className="size-[18px] text-cream-muted" aria-hidden />;
  if (entry.kind.includes("Image") || entry.kind.includes("SVG"))
    return <Image className="size-[18px] text-cream-muted" aria-hidden />;
  return <FileText className="size-[18px] text-cream-muted" aria-hidden />;
}

function Preview({ state }: { state: FilesState }) {
  if (!state.preview)
    return (
      <div className="grid flex-1 place-items-center px-8 text-center text-sm text-cream-muted">
        <span>
          <FileSearch className="mx-auto mb-3 size-5" aria-hidden />
          Select a file to preview it and view its details.
        </span>
      </div>
    );
  const details = [
    ["Kind", "JPEG image"],
    ["Size", "8.4 MB"],
    ["Dimensions", "3200 × 1840"],
    ["Location", `${devices.studio} › Website launch`],
  ];
  return (
    <div className="p-4" data-t="files-preview">
      <div className="overflow-hidden rounded-lg border border-charcoal-border">
        <Notebooks className="block w-full" />
      </div>
      <p className="mt-4 text-[15px] font-semibold text-cream-bright">hero-photo.jpg</p>
      <dl className="mt-3 grid gap-2.5 text-sm">
        {details.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[86px_1fr] gap-2">
            <dt className="text-cream-muted">{label}</dt>
            <dd className="text-cream">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function ExplorerList({ state, items }: { state: FilesState; items: Entry[] }) {
  return (
    <>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="grid h-10 grid-cols-[1fr_170px_90px_110px] items-center border-b border-charcoal-border px-4 text-sm font-medium text-cream-muted">
          <span className="flex items-center gap-1 text-cream">
            Name <ChevronUp className="size-3.5" />
          </span>
          <span>Modified</span>
          <span>Size</span>
          <span>Type</span>
        </div>
        <div className="flex-1 px-2 pt-1">
          {items.map((entry) => (
            <div
              key={entry.name}
              data-t={`file-${entry.name}`}
              className={cn(
                "grid h-11 grid-cols-[1fr_170px_90px_110px] items-center rounded-lg px-2 text-sm text-cream-muted",
                state.selected === entry.name && "bg-[#2f2f2f] text-cream",
                state.highlightRow === entry.name && state.selected !== entry.name && "bg-control-hover",
              )}
            >
              <span className="flex min-w-0 items-center gap-2.5 font-medium text-cream">
                <EntryIcon entry={entry} />
                <span className="truncate">{entry.name}</span>
              </span>
              <span>{entry.modified}</span>
              <span>{entry.size}</span>
              <span>{entry.kind}</span>
            </div>
          ))}
        </div>
        <p className="h-9 border-t border-charcoal-border px-4 pt-2 text-xs text-cream-muted">{items.length} items</p>
      </div>
      <aside className="flex w-[300px] shrink-0 flex-col border-l border-charcoal-border">
        <Preview state={state} />
      </aside>
    </>
  );
}
