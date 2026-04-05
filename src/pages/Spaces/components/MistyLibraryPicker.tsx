import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BookOpenText, Check, File, Image, Music2, Search, Video, X } from "lucide-react";
import { spacesApi } from "../../../spaces/api";
import type { SpaceLibraryItem } from "../../../spaces/types";
import { useDialogFocus } from "../../../shared/hooks/useDialogFocus";

type LibraryMediaFilter = "all" | "image" | "video" | "audio" | "document";

interface MistyLibraryPickerProps {
  spaceId: string;
  selectedIds: string[];
  maximumSelected?: number;
  onCancel: () => void;
  onChoose: (itemIds: string[]) => void;
}

const pickerControlClass = "inline-grid place-items-center rounded-lg border border-[var(--misty-border-soft)] bg-[var(--misty-neutral-control-bg,var(--misty-surface-2))] text-[var(--misty-text-muted)] transition-colors hover:bg-[var(--misty-neutral-hover-bg,var(--misty-surface-3))] hover:text-[var(--misty-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 disabled:cursor-default disabled:opacity-35";

export function MistyLibraryPicker({ spaceId, selectedIds, maximumSelected = 5, onCancel, onChoose }: MistyLibraryPickerProps) {
  const pickerDialog = useDialogFocus<HTMLElement>(true);
  const titleId = useId();
  const descriptionId = useId();
  const [items, setItems] = useState<SpaceLibraryItem[]>([]);
  const [selection, setSelection] = useState<string[]>(selectedIds.slice(0, maximumSelected));
  const [query, setQuery] = useState("");
  const [mediaFilter, setMediaFilter] = useState<LibraryMediaFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    void spacesApi.libraryItems(spaceId, { limit: 200, sort: "recently-added" }).then((result) => {
      if (current) setItems(result.items);
    }).catch((nextError: unknown) => {
      if (current) setError(nextError instanceof Error ? nextError.message : "Library items could not be loaded.");
    }).finally(() => {
      if (current) setLoading(false);
    });
    return () => { current = false; };
  }, [spaceId]);

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return items.filter((item) => {
      const mime = libraryPickerItemMIME(item);
      const matchesMedia = mediaFilter === "all"
        || mediaFilter === "document" && !/^(image|video|audio)\//.test(mime)
        || mediaFilter !== "document" && mime.startsWith(`${mediaFilter}/`);
      if (!matchesMedia) return false;
      return !normalizedQuery || [item.display_name, item.file.original_filename, item.tags.join(" ")].join(" ").toLocaleLowerCase().includes(normalizedQuery);
    });
  }, [items, mediaFilter, query]);

  const toggleItem = (itemId: string) => {
    setSelection((current) => current.includes(itemId)
      ? current.filter((candidate) => candidate !== itemId)
      : current.length < maximumSelected ? [...current, itemId] : current);
  };

  const handleDialogKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== "Tab" || !pickerDialog.dialogRef.current) return;
    const focusable = Array.from(pickerDialog.dialogRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])'));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  const picker = (
    <div className="fixed bottom-0 left-[72px] right-0 top-[var(--misty-window-titlebar-inset)] z-[2147483100] grid place-items-center bg-black/60 p-6 backdrop-blur-md max-[800px]:left-0 max-[800px]:p-3 max-[560px]:p-0" role="presentation" onKeyDown={handleDialogKeyDown}>
      <section ref={pickerDialog.dialogRef} tabIndex={-1} className="grid h-[min(680px,calc(100vh-88px))] w-[min(1100px,calc(100vw-140px))] grid-rows-[auto_auto_minmax(0,1fr)_auto] overflow-hidden rounded-2xl border border-[var(--misty-border)] bg-[var(--misty-app-modal-bg,var(--misty-surface))] text-[var(--misty-text)] shadow-2xl outline-none max-[800px]:size-full max-[560px]:rounded-none" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}>
        <header className="flex min-h-[76px] items-center justify-between gap-4 border-b border-[var(--misty-border-soft)] px-5">
          <div className="flex min-w-0 items-center gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--misty-surface-2)] text-[var(--misty-text-muted)]"><BookOpenText size={20}/></span><div><h2 className="m-0 text-[17px] font-semibold" id={titleId}>Choose from Library</h2><p className="mb-0 mt-1 text-xs leading-relaxed text-[var(--misty-text-subtle)]" id={descriptionId}>Select Library items to reference in this message.</p></div></div>
          <button type="button" className={`${pickerControlClass} size-[38px] shrink-0`} aria-label="Close picker" onClick={onCancel}><X size={18}/></button>
        </header>

        <div className="misty-library-picker-search-row">
          <div className="misty-library-picker-search" role="search">
            <Search aria-hidden="true" size={16}/>
            <input aria-label="Search Library" autoComplete="off" data-dialog-autofocus spellCheck={false} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search names, filenames, and tags"/>
          </div>
          <span className="misty-library-picker-search-count">{filteredItems.length} item{filteredItems.length === 1 ? "" : "s"}</span>
        </div>

        <div className="grid min-h-0 grid-cols-[220px_minmax(0,1fr)] max-[760px]:grid-cols-1">
          <aside className="min-h-0 overflow-y-auto border-r border-[var(--misty-divider-subtle)] p-3 max-[760px]:hidden">
            <p className="mb-2 mt-1 px-2 text-[10px] font-semibold capitalize text-[var(--misty-text-subtle)]">Media</p>
            {(["all", "image", "video", "audio", "document"] as LibraryMediaFilter[]).map((filter) => {
              const Icon = filter === "image" ? Image : filter === "video" ? Video : filter === "audio" ? Music2 : File;
              return <button className={`mb-1 flex w-full items-center gap-2.5 rounded-lg border-0 px-2.5 py-2 text-left text-xs ${mediaFilter === filter ? "bg-[var(--misty-surface-2)] text-[var(--misty-text)]" : "bg-transparent text-[var(--misty-text-muted)] hover:bg-[var(--misty-surface-2)]"}`} type="button" key={filter} onClick={() => setMediaFilter(filter)}><Icon size={15}/><span>{filter === "all" ? "All items" : filter[0].toUpperCase() + filter.slice(1)}</span></button>;
            })}
          </aside>

          <main className="min-h-0 overflow-y-auto bg-[var(--misty-app-page-bg,var(--misty-bg))] p-4">
            {loading ? <div className="grid h-full min-h-48 place-items-center text-sm text-[var(--misty-text-subtle)]">Loading Library…</div> : error ? <div className="grid h-full min-h-48 place-items-center px-8 text-center text-sm text-red-200">{error}</div> : filteredItems.length === 0 ? <div className="grid h-full min-h-48 place-items-center text-sm text-[var(--misty-text-subtle)]">No matching Library items.</div> : <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">{filteredItems.map((item) => {
              const selected = selection.includes(item.id);
              const unavailable = !selected && selection.length >= maximumSelected;
              return <button className={`group relative overflow-hidden rounded-xl border text-left transition-colors ${selected ? "border-[var(--misty-primary)] bg-[var(--misty-surface-2)]" : "border-[var(--misty-border-soft)] bg-[var(--misty-app-panel-bg,var(--misty-app-page-bg,var(--misty-bg)))] hover:border-[var(--misty-border-strong)]"} disabled:opacity-45`} type="button" key={item.id} disabled={unavailable} aria-pressed={selected} onClick={() => toggleItem(item.id)}>
                <span className="grid aspect-[4/3] w-full place-items-center overflow-hidden bg-black/20"><MistyLibraryPickerThumbnail spaceId={spaceId} item={item}/></span>
                <span className="block min-w-0 px-3 py-2.5"><span className="block truncate text-xs font-medium text-[var(--misty-text)]">{item.display_name}</span><span className="mt-1 block truncate text-[10px] text-[var(--misty-text-subtle)]">{item.file.original_filename}</span></span>
                <span className={`absolute right-2 top-2 grid size-6 place-items-center rounded-full border ${selected ? "border-[var(--misty-primary)] bg-[var(--misty-primary)] text-[var(--misty-primary-contrast)]" : "border-white/25 bg-black/45 text-transparent group-hover:text-white/40"}`}><Check size={13}/></span>
              </button>;
            })}</div>}
          </main>
        </div>

        <footer className="flex min-h-[72px] items-center justify-between gap-5 border-t border-[var(--misty-border-soft)] px-[18px]">
          <div className="grid min-w-0 gap-1"><span className="text-[10px] capitalize text-[var(--misty-text-subtle)]">Library Items</span><strong className="truncate text-xs font-semibold text-[var(--misty-text-muted)]">{selection.length} of {maximumSelected} selected</strong></div>
          <div className="ml-auto flex shrink-0 gap-2"><button type="button" className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[var(--misty-border-soft)] bg-[var(--misty-neutral-control-bg,var(--misty-surface-2))] px-4 text-[13px] text-[var(--misty-text-muted)] hover:bg-[var(--misty-neutral-hover-bg,var(--misty-surface-3))] hover:text-[var(--misty-text)]" onClick={onCancel}>Cancel</button><button type="button" className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[var(--misty-border-strong)] bg-[var(--misty-primary)] px-4 text-[13px] font-semibold text-[var(--misty-primary-contrast)] hover:bg-[var(--misty-primary-hover)] disabled:opacity-45" disabled={loading || selection.length === 0} onClick={() => onChoose(selection)}>Add {selection.length} item{selection.length === 1 ? "" : "s"}</button></div>
        </footer>
      </section>
    </div>
  );

  return typeof document === "undefined" ? null : createPortal(picker, document.body);
}

function MistyLibraryPickerThumbnail({ spaceId, item }: { spaceId: string; item: SpaceLibraryItem }) {
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const [visible, setVisible] = useState(typeof IntersectionObserver === "undefined");
  const [url, setURL] = useState("");
  const mime = libraryPickerItemMIME(item);
  const previewable = /^(image|video)\//.test(mime) || Number(item.file.intrinsic_metadata.width ?? 0) > 0;

  useEffect(() => {
    const root = rootRef.current;
    if (!root || visible || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
    }, { rootMargin: "160px" });
    observer.observe(root);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible || !previewable) return;
    let current = true;
    let objectURL = "";
    void spacesApi.libraryPreview(spaceId, item.id, "", item.version).then((blob) => {
      if (!current) return;
      objectURL = URL.createObjectURL(blob);
      setURL(objectURL);
    }).catch(() => undefined);
    return () => {
      current = false;
      if (objectURL) URL.revokeObjectURL(objectURL);
    };
  }, [item.id, item.version, previewable, spaceId, visible]);

  const Icon = mime.startsWith("image/") ? Image : mime.startsWith("video/") ? Video : mime.startsWith("audio/") ? Music2 : File;
  return <span ref={rootRef} className="grid size-full place-items-center text-[var(--misty-text-subtle)]">{url ? <img className="size-full object-cover" src={url} alt=""/> : <Icon size={28}/>}</span>;
}

function libraryPickerItemMIME(item: SpaceLibraryItem): string {
  const metadata = item.file.intrinsic_metadata;
  return String(metadata.server_detected_mime_type ?? metadata.client_declared_mime_type ?? "application/octet-stream").split(";")[0].toLocaleLowerCase();
}
