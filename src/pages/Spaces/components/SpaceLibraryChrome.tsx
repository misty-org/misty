import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Image as ImageIcon, Search, Upload, X, ZoomIn, ZoomOut } from "lucide-react";
import type { LibraryItemQuery } from "../../../spaces/types";
import { useBoundedFloating } from "../../../shared/hooks/useBoundedFloating";

type PrimaryCollection = "recent" | "months" | "years" | "collections";
type UtilityCollection = "recent" | "favorites" | "hidden" | "deleted";

interface SpaceLibraryHeaderProps {
  sectionNavigation: ReactNode;
  collection: string;
  onSelectCollection: (collection: PrimaryCollection) => void;
  uploading: boolean;
  uploadDisabled: boolean;
  onUpload: () => void;
  searchInput: string;
  onSearchInput: (value: string) => void;
  onSearchFocus: () => void;
  onSearchBlur: () => void;
  mediaType: string;
  onMediaType: (value: string) => void;
  onSelectUtility: (collection: UtilityCollection) => void;
  sort: NonNullable<LibraryItemQuery["sort"]>;
  direction: NonNullable<LibraryItemQuery["direction"]>;
  onSort: (sort: NonNullable<LibraryItemQuery["sort"]>, direction: NonNullable<LibraryItemQuery["direction"]>) => void;
  albumOrderAvailable: boolean;
  gridSize: number;
  squareGrid: boolean;
  onSmallerGrid: () => void;
  onLargerGrid: () => void;
  onToggleSquareGrid: () => void;
  visibleItemCount: number;
  selecting: boolean;
  onToggleSelecting: () => void;
}

const primaryCollections: Array<{ id: PrimaryCollection; label: string }> = [
  { id: "recent", label: "Recently Added" },
  { id: "months", label: "Months" },
  { id: "years", label: "Years" },
  { id: "collections", label: "Collections" },
];

const mediaTypeOptions = [
  { value: "", label: "All media" },
  { value: "image", label: "Images" },
  { value: "video", label: "Videos" },
  { value: "audio", label: "Audio" },
  { value: "document", label: "Documents" },
  { value: "selfies", label: "Selfies" },
  { value: "live-photos", label: "Live Photos" },
  { value: "portraits", label: "Portraits" },
  { value: "panoramas", label: "Panoramas" },
  { value: "slo-mo", label: "Slo-mo" },
  { value: "cinematic", label: "Cinematic" },
  { value: "bursts", label: "Bursts" },
  { value: "raw", label: "RAW" },
  { value: "screenshots", label: "Screenshots" },
  { value: "screen-recordings", label: "Screen Recordings" },
  { value: "spatial", label: "Spatial" },
];

const utilityOptions = [
  { value: "", label: "More" },
  { value: "favorites", label: "Favorites" },
  { value: "hidden", label: "Hidden" },
  { value: "deleted", label: "Recently Deleted" },
];

const sortOptions = [
  { value: "recently-added:desc", label: "Newest added" },
  { value: "recently-added:asc", label: "Oldest added" },
  { value: "date-captured:desc", label: "Newest captured" },
  { value: "date-captured:asc", label: "Oldest captured" },
  { value: "name:asc", label: "Name A–Z" },
  { value: "name:desc", label: "Name Z–A" },
  { value: "size:desc", label: "Largest" },
  { value: "size:asc", label: "Smallest" },
];

export function SpaceLibraryHeader(props: SpaceLibraryHeaderProps) {
  const utilityValue = ["favorites", "hidden", "deleted"].includes(props.collection) ? props.collection : "";
  const hasVisibleItems = props.visibleItemCount > 0;

  return (
    <header className="shrink-0 border-b border-[var(--misty-border-soft)] bg-[var(--misty-bg)]">
      <div className="flex min-h-[52px] items-center justify-end border-b border-[var(--misty-border-soft)] px-6 py-2">
        {props.sectionNavigation}
      </div>

      <div className="px-6 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <nav className="flex min-w-0 items-center gap-1 overflow-x-auto rounded-xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface)] p-1" aria-label="Library collections">
            {primaryCollections.map(({ id, label }) => (
              <button
                className={`min-h-9 shrink-0 whitespace-nowrap rounded-lg border px-3 text-xs font-medium transition-colors ${props.collection === id ? "border-[var(--misty-border-strong)] bg-[var(--misty-surface-3)] text-[var(--misty-text)] shadow-sm" : "border-transparent bg-transparent text-[var(--misty-text-muted)] hover:bg-[var(--misty-surface-2)] hover:text-[var(--misty-text)]"}`}
                type="button"
                key={id}
                aria-current={props.collection === id ? "page" : undefined}
                onClick={() => props.onSelectCollection(id)}
              >
                {label}
              </button>
            ))}
          </nav>
          {hasVisibleItems ? (
            <button className="ml-auto inline-flex min-h-9 shrink-0 items-center gap-2 rounded-xl border-0 bg-[var(--misty-primary)] px-4 text-xs font-semibold text-[var(--misty-primary-contrast)] shadow-sm transition-colors hover:bg-[var(--misty-primary-hover)] disabled:opacity-45" type="button" disabled={props.uploadDisabled} onClick={props.onUpload}>
              <Upload size={15} aria-hidden="true" />
              {props.uploading ? "Uploading…" : "Upload files"}
            </button>
          ) : null}
        </div>

        <div className="mt-2.5 flex min-w-0 flex-wrap items-center gap-2.5">
          <label className="!flex h-9 min-w-[240px] flex-1 items-center gap-2.5 overflow-hidden rounded-xl border border-[var(--misty-border-strong)] bg-[var(--misty-surface-2)] px-3 text-[var(--misty-text-muted)] transition-colors focus-within:border-[var(--misty-accent)] focus-within:ring-2 focus-within:ring-[var(--misty-focus-ring)]">
            <Search size={15} aria-hidden="true" />
            <input className="!m-0 !h-full !min-h-0 min-w-0 flex-1 !rounded-none !border-0 !bg-transparent !p-0 !shadow-none text-sm leading-none text-[var(--misty-text)] outline-none placeholder:text-[var(--misty-text-subtle)]" value={props.searchInput} onChange={(event) => props.onSearchInput(event.target.value)} onFocus={props.onSearchFocus} onBlur={props.onSearchBlur} placeholder="Search this Space" aria-label="Search Library" />
            {props.searchInput ? <button className="grid size-6 shrink-0 place-items-center rounded-md border-0 bg-transparent p-0 text-[var(--misty-text-subtle)] hover:bg-[var(--misty-surface-3)] hover:text-[var(--misty-text)]" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => props.onSearchInput("")} aria-label="Clear Library search"><X size={13}/></button> : null}
          </label>

          <div className="flex min-w-0 flex-wrap items-center gap-2" aria-label="Library view controls">
            <MistyDropdown className="w-[150px]" label="Filter by media type" value={props.mediaType} options={mediaTypeOptions} onChange={props.onMediaType}/>
            <MistyDropdown className="w-[140px]" label="Choose a Library utility" value={utilityValue} options={utilityOptions} onChange={(value) => props.onSelectUtility((value || "recent") as UtilityCollection)}/>
            {hasVisibleItems ? (
              <>
                <MistyDropdown className="w-[160px]" label="Sort Library" value={`${props.sort}:${props.direction}`} options={props.albumOrderAvailable ? [{ value: "album-order:asc", label: "Album order" }, ...sortOptions] : sortOptions} onChange={(value) => { const [sort, direction] = value.split(":") as [NonNullable<LibraryItemQuery["sort"]>, NonNullable<LibraryItemQuery["direction"]>]; props.onSort(sort, direction); }}/>
                <div className="flex h-9 shrink-0 items-center overflow-hidden rounded-xl border border-[var(--misty-border-strong)] bg-[var(--misty-surface-2)]" aria-label="Thumbnail size controls">
                  <button className="grid size-9 place-items-center border-0 bg-transparent p-0 text-[var(--misty-text-muted)] hover:bg-[var(--misty-surface-3)] hover:text-[var(--misty-text)] disabled:opacity-30" type="button" disabled={props.gridSize <= 120} onClick={props.onSmallerGrid} aria-label="Show smaller Library thumbnails"><ZoomOut size={14}/></button>
                  <button className="grid size-9 place-items-center border-0 border-l border-[var(--misty-border-soft)] bg-transparent p-0 text-[var(--misty-text-muted)] hover:bg-[var(--misty-surface-3)] hover:text-[var(--misty-text)] disabled:opacity-30" type="button" disabled={props.gridSize >= 300} onClick={props.onLargerGrid} aria-label="Show larger Library thumbnails"><ZoomIn size={14}/></button>
                  <button className={`h-full border-0 border-l border-[var(--misty-border-soft)] px-2.5 text-[10px] font-semibold ${props.squareGrid ? "bg-[var(--misty-surface-3)] text-[var(--misty-text)]" : "bg-transparent text-[var(--misty-text-muted)] hover:bg-[var(--misty-surface-3)]"}`} type="button" onClick={props.onToggleSquareGrid} aria-pressed={props.squareGrid} aria-label="Toggle square Library thumbnails">1:1</button>
                </div>
                <button className="inline-flex h-9 shrink-0 items-center rounded-xl border border-[var(--misty-border-strong)] bg-[var(--misty-surface-2)] px-3 text-xs font-medium text-[var(--misty-text)] hover:bg-[var(--misty-surface-3)]" type="button" onClick={props.onToggleSelecting}>{props.selecting ? "Cancel" : "Select"}</button>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}

interface MistyDropdownProps {
  className: string;
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}

function MistyDropdown(props: MistyDropdownProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxId = useId();
  const { floatingRef, floatingStyle, opensAbove } = useBoundedFloating({
    open,
    anchorRef: triggerRef,
    preferredMaxHeight: 288,
    minimumUsefulHeight: 96,
  });
  const selectedIndex = Math.max(0, props.options.findIndex((option) => option.value === props.value));
  const selectedOption = props.options[selectedIndex] ?? props.options[0];

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !floatingRef.current?.contains(target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [floatingRef, open]);

  const focusOption = (index: number) => {
    const optionButtons = floatingRef.current?.querySelectorAll<HTMLButtonElement>("[role='option']");
    optionButtons?.[Math.max(0, Math.min(index, (optionButtons.length ?? 1) - 1))]?.focus();
  };
  const openAndFocus = (index: number) => {
    setOpen(true);
    window.requestAnimationFrame(() => focusOption(index));
  };
  const handleTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    openAndFocus(event.key === "ArrowDown" ? selectedIndex : Math.max(0, selectedIndex - 1));
  };
  const handleOptionKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      focusOption(index + (event.key === "ArrowDown" ? 1 : -1));
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      focusOption(event.key === "Home" ? 0 : props.options.length - 1);
    }
  };
  const selectOption = (value: string) => {
    props.onChange(value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div className={`relative shrink-0 ${props.className}`} ref={rootRef}>
      <button className={`flex h-9 w-full items-center justify-between gap-2 rounded-xl border bg-[var(--misty-surface-2)] px-3 text-left text-xs text-[var(--misty-text)] outline-none transition-colors hover:bg-[var(--misty-neutral-hover-bg,var(--misty-surface-3))] focus-visible:ring-2 focus-visible:ring-[var(--misty-focus-ring)] ${open ? "border-[var(--misty-accent)]" : "border-[var(--misty-border-strong)]"}`} type="button" ref={triggerRef} aria-label={props.label} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listboxId : undefined} onClick={() => setOpen((current) => !current)} onKeyDown={handleTriggerKeyDown}>
        <span className="min-w-0 truncate">{selectedOption?.label}</span>
        <ChevronDown className={`shrink-0 text-[var(--misty-text-subtle)] transition-transform ${open ? "rotate-180" : ""}`} size={14} aria-hidden="true"/>
      </button>
      {open ? createPortal(
        <div className="z-[2147482900] grid gap-0.5 overflow-y-auto rounded-xl border border-[var(--misty-border)] bg-[var(--misty-app-surface-bg,var(--misty-dropdown-bg))] p-1.5 shadow-[0_14px_38px_var(--misty-shadow)]" id={listboxId} ref={floatingRef} role="listbox" aria-label={props.label} data-placement={opensAbove ? "top" : "bottom"} style={floatingStyle}>
          {props.options.map((option, index) => {
            const selected = option.value === props.value;
            return <button className={`grid min-h-8 w-full grid-cols-[minmax(0,1fr)_16px] items-center gap-3 rounded-lg border-0 px-2.5 py-1.5 text-left text-xs transition-colors ${selected ? "bg-[var(--misty-neutral-selected-bg,var(--misty-surface-3))] text-[var(--misty-text)]" : "bg-transparent text-[var(--misty-text-muted)] hover:bg-[var(--misty-neutral-hover-bg,var(--misty-surface-2))] hover:text-[var(--misty-text)]"}`} type="button" key={option.value || "default"} role="option" aria-selected={selected} onClick={() => selectOption(option.value)} onKeyDown={(event) => handleOptionKeyDown(event, index)}><span className="truncate">{option.label}</span>{selected ? <Check size={14} aria-hidden="true"/> : null}</button>;
          })}
        </div>,
        document.body,
      ) : null}
    </div>
  );
}

interface SpaceLibraryEmptyStateProps {
  collection: string;
  searching?: boolean;
  uploading: boolean;
  uploadDisabled: boolean;
  onUpload: () => void;
  onClearSearch?: () => void;
}

export function SpaceLibraryEmptyState(props: SpaceLibraryEmptyStateProps) {
  const label = collectionLabel(props.collection);
  const title = props.searching ? "No matching items" : props.collection === "recent" ? "Build your library" : `No items in ${label}`;
  const detail = props.searching
    ? "Try a different search or clear your filters to see everything in this Space."
    : props.collection === "recent"
      ? "Upload photos, videos, audio, and documents."
      : `Items added to ${label} will appear here.`;

  return (
    <div className="grid h-full min-h-[300px] place-items-center px-4 py-8">
      <section className="grid w-full max-w-sm justify-items-center rounded-2xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface)] px-7 py-7 text-center shadow-[0_12px_36px_rgba(0,0,0,0.12)]" aria-label={title}>
        <span className="grid size-11 place-items-center rounded-xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] text-[var(--misty-text-muted)]">
          {props.searching ? <Search size={19} aria-hidden="true" /> : <ImageIcon size={20} aria-hidden="true" />}
        </span>
        <h3 className="mb-0 mt-3.5 text-base font-semibold text-[var(--misty-text)]">{title}</h3>
        <p className="mb-0 mt-1.5 max-w-xs text-sm leading-relaxed text-[var(--misty-text-muted)]">{detail}</p>
        <div className="mt-4.5 flex flex-wrap justify-center gap-2">
          {props.searching && props.onClearSearch ? <button className="inline-flex min-h-10 items-center rounded-xl border border-[var(--misty-border-strong)] bg-[var(--misty-surface-2)] px-4 text-xs font-medium text-[var(--misty-text)] hover:bg-[var(--misty-surface-3)]" type="button" onClick={props.onClearSearch}>Clear search</button> : null}
          {!props.searching || props.collection === "recent" ? <button className="inline-flex min-h-10 items-center gap-2 rounded-xl border-0 bg-[var(--misty-primary)] px-4 text-xs font-semibold text-[var(--misty-primary-contrast)] hover:bg-[var(--misty-primary-hover)] disabled:opacity-45" type="button" disabled={props.uploadDisabled} onClick={props.onUpload}><Upload size={15}/>{props.uploading ? "Uploading…" : "Upload files"}</button> : null}
        </div>
      </section>
    </div>
  );
}

function collectionLabel(collection: string): string {
  return ({ months: "Months", years: "Years", collections: "Collections", favorites: "Favorites", hidden: "Hidden", deleted: "Recently Deleted", people: "People & Pets", albums: "Albums", groups: "Groups", map: "Map", shared: "Shared", imports: "Imports" } as Record<string, string>)[collection] ?? "this collection";
}
