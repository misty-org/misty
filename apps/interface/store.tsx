import {
  Blocks,
  ChevronLeft,
  ChevronRight,
  Download,
  FolderOpen,
  LayoutGrid,
  PanelLeftClose,
  PanelLeftOpen,
  PanelsTopLeft,
  RefreshCcw,
  Search,
  ShieldCheck,
  Store as StoreIcon,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

import { filterExtensionCatalog, type ExtensionPresentation } from "./catalog";
import "./store.css";

export type StoreSection = "featured" | "apps" | "extensions" | "installed";

export type StoreSurfaceEntry = ExtensionPresentation & {
  readonly kind?: "app" | "extension" | "builtin";
  readonly installed: boolean;
  readonly enabled: boolean;
};

export type StoreSurfaceProps<T extends StoreSurfaceEntry> = {
  readonly entries: readonly T[];
  readonly installedEntries?: readonly T[];
  readonly query: string;
  readonly loading?: boolean;
  readonly statusContent?: ReactNode;
  readonly className?: string;
  readonly initialSection?: StoreSection;
  readonly section?: StoreSection;
  readonly onSectionChange?: (section: StoreSection) => void;
  readonly onQueryChange: (query: string) => void;
  readonly onRefresh?: () => void;
  readonly onSelect?: (entry: T) => void;
  readonly renderIcon: (
    entry: T,
    options: { className: string; size: "small" | "large" },
  ) => ReactNode;
  readonly renderPrimaryAction: (
    entry: T,
    options: { className: string; compact: boolean },
  ) => ReactNode;
};

const pageSize = 50;
const defaultSidebarWidth = 240;
const minSidebarWidth = 220;
const maxSidebarWidth = 360;

const sections = [
  { id: "featured", label: "Featured", Icon: SquareStarIcon },
  { id: "apps", label: "Apps", Icon: LayoutGrid },
  { id: "extensions", label: "Extensions", Icon: Blocks },
  { id: "installed", label: "Installed", Icon: Download },
] as const;

type CatalogCategory = "all" | "installed" | "media" | "utilities" | "ai";

const appCategoryOptions: { id: CatalogCategory; label: string }[] = [
  { id: "all", label: "All Apps" },
  { id: "installed", label: "Installed" },
  { id: "media", label: "Media & Creative" },
  { id: "utilities", label: "Utilities & System" },
  { id: "ai", label: "AI & Collaboration" },
];

function matchesCategory(entry: StoreSurfaceEntry, category: CatalogCategory): boolean {
  if (category === "all") return true;
  if (category === "installed") return entry.installed;
  const hay = `${entry.id} ${entry.name} ${entry.overview} ${(entry.capabilities ?? []).join(" ")}`.toLowerCase();
  if (category === "media") {
    return /media|convert|image|video|audio|jpeg|png|webp|ffmpeg|ytdlp|youtube/.test(hay);
  }
  if (category === "utilities") {
    return /storage|backup|file|folder|system|disk|theme|vault|restic/.test(hay);
  }
  if (category === "ai") {
    return /agent|ai|bot|collaborat|inbox|social|chat|journal|note/.test(hay);
  }
  return true;
}

function SquareStarIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={`lucide lucide-square-star ${className}`.trim()}
      fill="none"
      viewBox="0 0 24 24"
    >
      <rect height="18" rx="2" stroke="currentColor" strokeWidth="2" width="18" x="3" y="3" />
      <path
        d="m12 7.4 1.35 2.73 3.02.44-2.18 2.13.51 3.01L12 14.29 9.3 15.71l.51-3.01-2.18-2.13 3.02-.44L12 7.4Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

export function StoreSurface<T extends StoreSurfaceEntry>({
  entries,
  installedEntries = [],
  query,
  loading = false,
  statusContent,
  className = "",
  initialSection,
  section: controlledSection,
  onSectionChange,
  onQueryChange,
  onRefresh,
  onSelect,
  renderIcon,
  renderPrimaryAction,
}: StoreSurfaceProps<T>) {
  const [internalSection, setInternalSection] = useState<StoreSection>(
    initialSection ?? "featured",
  );
  const section = controlledSection ?? internalSection;
  const setSection = (nextSection: StoreSection) => {
    setInternalSection(nextSection);
    onSectionChange?.(nextSection);
  };
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(defaultSidebarWidth);
  const [resizing, setResizing] = useState(false);
  const layoutRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const pendingX = useRef(0);
  const frame = useRef<number | null>(null);

  const apps = useMemo(
    () => entries.filter((entry) => entry.kind !== "extension"),
    [entries],
  );
  const extensions = useMemo(
    () => entries.filter((entry) => entry.kind === "extension"),
    [entries],
  );
  const installed = useMemo(
    () => installedEntries.filter((entry) => entry.kind !== "builtin" && entry.installed),
    [installedEntries],
  );
  const searchedApps = useMemo(() => filterExtensionCatalog(apps, query), [apps, query]);
  const searchedExtensions = useMemo(
    () => filterExtensionCatalog(extensions, query),
    [extensions, query],
  );
  const searching = query.trim().length > 0;

  useEffect(() => {
    const handleGlobalKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  useEffect(() => {
    if (!resizing) return;

    const previousCursor = document.body.style.cursor;
    const previousSelection = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const applyResize = () => {
      frame.current = null;
      const rect = layoutRef.current?.getBoundingClientRect();
      if (!rect) return;
      setSidebarWidth(clampSidebar(pendingX.current - rect.left));
    };
    const move = (event: globalThis.PointerEvent) => {
      pendingX.current = event.clientX;
      if (frame.current === null) frame.current = window.requestAnimationFrame(applyResize);
    };
    const stop = () => setResizing(false);

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
    window.addEventListener("pointercancel", stop, { once: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      if (frame.current !== null) window.cancelAnimationFrame(frame.current);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelection;
    };
  }, [resizing]);

  const changeSection = (next: StoreSection) => {
    setSection(next);
    if (query) onQueryChange("");
  };

  const resizeWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setSidebarWidth(event.key === "Home" ? minSidebarWidth : maxSidebarWidth);
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const change = event.key === "ArrowLeft" ? -16 : 16;
      setSidebarWidth((width) => clampSidebar(width + change));
    }
  };

  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    pendingX.current = event.clientX;
    setResizing(true);
  };

  return (
    <div
      className={`misty-store ${className}`.trim()}
      data-store-layout="true"
      ref={layoutRef}
    >
      <div className="misty-store__body">
        {sidebarOpen ? (
          <div
            className="misty-store__sidebar-shell"
            data-store-sidebar-shell="true"
            style={{ width: sidebarWidth }}
          >
            <aside className="misty-store__sidebar" data-store-sidebar="true">
              <div className="misty-store__brand">
                <StoreIcon aria-hidden="true" />
                <h1>Store</h1>
              </div>
              <nav aria-label="Store sections" className="misty-store__nav">
                {sections.map(({ id, label, Icon }) => {
                  const selected = section === id;
                  return (
                    <button
                      aria-current={selected ? "page" : undefined}
                      aria-label={id === "featured" ? "Browse featured" : `Browse ${id}`}
                      className="misty-store__nav-item"
                      data-selected={selected ? "true" : "false"}
                      key={id}
                      onClick={() => changeSection(id)}
                      type="button"
                    >
                      <Icon aria-hidden="true" />
                      <span>{label}</span>
                      {id === "installed" ? (
                        <span className="misty-store__nav-count">{installed.length}</span>
                      ) : null}
                    </button>
                  );
                })}
              </nav>
            </aside>
            <div
              aria-label="Resize Store sidebar"
              aria-orientation="vertical"
              aria-valuemax={maxSidebarWidth}
              aria-valuemin={minSidebarWidth}
              aria-valuenow={sidebarWidth}
              className="misty-store__resizer"
              data-active={resizing ? "true" : "false"}
              data-store-sidebar-resizer="true"
              onDoubleClick={() => setSidebarWidth(defaultSidebarWidth)}
              onKeyDown={resizeWithKeyboard}
              onPointerDown={startResize}
              role="separator"
              tabIndex={0}
            />
          </div>
        ) : null}

        <div className="misty-store__workspace">
          <header className="misty-store__search-bar">
            <div className="misty-store__search-wrap">
              <Search aria-hidden="true" />
              <input
                aria-label="Search Store"
                disabled={loading && entries.length === 0}
                onChange={(event) => onQueryChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape" && query) onQueryChange("");
                }}
                placeholder="Search Store"
                ref={searchInputRef}
                type="search"
                value={query}
              />
              <kbd className="misty-store__search-shortcut">⌘K</kbd>
            </div>
            {onRefresh ? (
              <button
                aria-label="Reload Store"
                className="misty-store__icon-button"
                disabled={loading}
                onClick={onRefresh}
                title="Reload Store"
                type="button"
              >
                <RefreshCcw aria-hidden="true" className={loading ? "is-spinning" : ""} />
              </button>
            ) : null}
            {statusContent ? <div className="misty-store__status">{statusContent}</div> : null}
          </header>

          <main className="misty-store__content">
            {searching ? (
              <div className="misty-store__catalog-stack">
                <StoreCatalog
                  description="Built-in and installable apps that match your search."
                  empty="No apps match this search."
                  entries={searchedApps}
                  loading={loading}
                  onSelect={onSelect}
                  renderIcon={renderIcon}
                  renderPrimaryAction={renderPrimaryAction}
                  title="Apps"
                />
                <StoreCatalog
                  description="Installable capabilities that match your search. Review details and permissions before installing."
                  empty="No extensions match this search."
                  entries={searchedExtensions}
                  loading={loading}
                  onSelect={onSelect}
                  renderIcon={renderIcon}
                  renderPrimaryAction={renderPrimaryAction}
                  title="Extensions"
                />
              </div>
            ) : section === "featured" ? (
              <StoreHome
                apps={apps}
                loading={loading}
                onNavigate={changeSection}
                onSelect={onSelect}
                renderIcon={renderIcon}
                renderPrimaryAction={renderPrimaryAction}
              />
            ) : section === "apps" ? (
              <StoreCatalog
                categoryOptions={appCategoryOptions}
                description="Built-in and installable apps open as full workspace tabs."
                empty="No apps are available."
                entries={apps}
                loading={loading}
                onSelect={onSelect}
                renderIcon={renderIcon}
                renderPrimaryAction={renderPrimaryAction}
                showCategories
                title="Apps"
              />
            ) : section === "extensions" ? (
              <StoreCatalog
                description="Extensions enhance an existing app at runtime, such as annotations inside Browser."
                empty="No app extensions are available yet."
                entries={extensions}
                loading={loading}
                onSelect={onSelect}
                renderIcon={renderIcon}
                renderPrimaryAction={renderPrimaryAction}
                title="Extensions"
              />
            ) : (
              <StoreCatalog
                description="Manage the apps installed on this device. Built-in apps are always available."
                empty="You have not installed any apps yet."
                entries={installed}
                loading={loading}
                onSelect={onSelect}
                renderIcon={renderIcon}
                renderPrimaryAction={renderPrimaryAction}
                title="Installed apps"
              />
            )}
          </main>
        </div>
      </div>

      <footer className="misty-store__bottom-bar" data-store-bottom-bar="true">
        <button
          aria-expanded={sidebarOpen}
          aria-label={sidebarOpen ? "Hide Store sidebar" : "Show Store sidebar"}
          className="misty-store__icon-button"
          onClick={() => setSidebarOpen((open) => !open)}
          title={sidebarOpen ? "Hide Store sidebar" : "Show Store sidebar"}
          type="button"
        >
          {sidebarOpen ? <PanelLeftClose aria-hidden="true" /> : <PanelLeftOpen aria-hidden="true" />}
        </button>
      </footer>
    </div>
  );
}

type StoreChildrenProps<T extends StoreSurfaceEntry> = Pick<
  StoreSurfaceProps<T>,
  "onSelect" | "renderIcon" | "renderPrimaryAction"
>;

function StoreHome<T extends StoreSurfaceEntry>({
  apps,
  loading,
  onNavigate,
  onSelect,
  renderIcon,
  renderPrimaryAction,
}: StoreChildrenProps<T> & {
  apps: readonly T[];
  loading: boolean;
  onNavigate: (section: StoreSection) => void;
}) {
  const featured = [...apps]
    .filter((entry) => entry.kind !== "builtin")
    .sort((left, right) => (left.featuredRank ?? 999) - (right.featuredRank ?? 999));
  const featuredEntry =
    featured.find((entry) => entry.id.replace(/-/g, "_") === "storage_report") ?? featured[0] ?? apps[0];
  const featuredApps = (featured.length > 0 ? featured : apps).slice(0, 4);
  const essentials = apps.filter((entry) => entry.kind === "builtin").slice(0, 4);

  return (
    <div className="misty-store__home">
      {featuredEntry ? (
        <FeaturedEntry
          entry={featuredEntry}
          loading={loading}
          onSelect={onSelect}
          renderIcon={renderIcon}
          renderPrimaryAction={renderPrimaryAction}
        />
      ) : null}
      <section aria-label="Browse Store categories" className="misty-store__categories">
        <CategoryCard
          description="Built-in and installable tools that open in your Misty workspace."
          Icon={LayoutGrid}
          label="Browse apps"
          onClick={() => onNavigate("apps")}
        />
        <CategoryCard
          description="Add new capabilities to customize and extend your workspace."
          Icon={Blocks}
          label="Explore extensions"
          onClick={() => onNavigate("extensions")}
        />
      </section>
      <StoreShelf
        actionLabel="View all apps"
        entries={featuredApps}
        onAction={() => onNavigate("apps")}
        onSelect={onSelect}
        renderIcon={renderIcon}
        renderPrimaryAction={renderPrimaryAction}
        title="Featured apps"
      />
      <StoreShelf
        actionLabel="View all apps"
        entries={essentials}
        onAction={() => onNavigate("apps")}
        onSelect={onSelect}
        renderIcon={renderIcon}
        renderPrimaryAction={renderPrimaryAction}
        title="Essential apps"
      />
    </div>
  );
}

function FeaturedEntry<T extends StoreSurfaceEntry>({
  entry,
  loading,
  onSelect,
  renderIcon,
  renderPrimaryAction,
}: StoreChildrenProps<T> & { entry: T; loading: boolean }) {
  return (
    <section className="misty-store__feature">
      <div className="misty-store__feature-summary">
        <div className="misty-store__entry-heading">
          {renderIcon(entry, { className: "misty-store__entry-icon", size: "large" })}
          <div>
            <div className="misty-store__entry-name-row">
              <h2>{entry.name}</h2>
              <span className="misty-store__featured-badge">Featured</span>
            </div>
            <p>{entry.author ?? "Misty"} · v{entry.version} · App</p>
          </div>
        </div>
        <p className="misty-store__overview">{entry.overview}</p>
        <div className="misty-store__feature-action">
          {renderPrimaryAction(entry, {
            className: "misty-store__action",
            compact: false,
          })}
        </div>
      </div>
      <button
        aria-label={`View ${entry.name} details`}
        className="misty-store__feature-details"
        disabled={!onSelect || loading}
        onClick={() => onSelect?.(entry)}
        type="button"
      >
        <div className="misty-store__capabilities">
          <strong>Inside {entry.name}</strong>
          <div>
            {entry.capabilities.slice(0, 3).map((capability) => (
              <p key={capability}>
                <FolderOpen aria-hidden="true" />
                <span>{capability}</span>
              </p>
            ))}
          </div>
        </div>
        <div className="misty-store__placement">
          <PanelsTopLeft aria-hidden="true" />
          <strong>Where it appears</strong>
          <p>{entry.whereItAppears.join(", ")}</p>
          {entry.verified ? (
            <span><ShieldCheck aria-hidden="true" /> Verified catalog entry</span>
          ) : null}
        </div>
      </button>
    </section>
  );
}

function CategoryCard({
  description,
  Icon,
  label,
  onClick,
}: {
  description: string;
  Icon: typeof LayoutGrid;
  label: string;
  onClick: () => void;
}) {
  return (
    <button className="misty-store__category" onClick={onClick} type="button">
      <span className="misty-store__category-icon"><Icon aria-hidden="true" /></span>
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
        <span className="misty-store__explore">Explore <ChevronRight aria-hidden="true" /></span>
      </span>
    </button>
  );
}

function StoreShelf<T extends StoreSurfaceEntry>({
  actionLabel,
  entries,
  onAction,
  onSelect,
  renderIcon,
  renderPrimaryAction,
  title,
}: StoreChildrenProps<T> & {
  actionLabel: string;
  entries: readonly T[];
  onAction: () => void;
  title: string;
}) {
  return (
    <section aria-labelledby={`store-${slug(title)}`}>
      <div className="misty-store__shelf-heading">
        <h2 id={`store-${slug(title)}`}>{title}</h2>
        <button onClick={onAction} type="button">{actionLabel}<ChevronRight aria-hidden="true" /></button>
      </div>
      <div className="misty-store__shelf">
        {entries.map((entry) => (
          <CompactEntry
            entry={entry}
            key={entry.id}
            onSelect={onSelect}
            renderIcon={renderIcon}
            renderPrimaryAction={renderPrimaryAction}
          />
        ))}
      </div>
    </section>
  );
}

function CompactEntry<T extends StoreSurfaceEntry>({
  entry,
  onSelect,
  renderIcon,
  renderPrimaryAction,
}: StoreChildrenProps<T> & { entry: T }) {
  const author = entry.author ?? "Misty";
  const version = entry.version ? `v${entry.version}` : null;
  const isBuiltin = entry.kind === "builtin";

  return (
    <article className="misty-store__compact-card" data-installed={entry.installed ? "true" : "false"}>
      <div className="misty-store__compact-top">
        <div className="misty-store__compact-icon-wrap">
          {renderIcon(entry, { className: "misty-store__entry-icon", size: "small" })}
        </div>
        <div className="misty-store__compact-action">
          {renderPrimaryAction(entry, { className: "misty-store__action", compact: true })}
        </div>
      </div>
      <div className="misty-store__compact-copy">
        <div className="misty-store__compact-header">
          <p data-marketplace-entry-name="true">{entry.name}</p>
          {entry.verified ? (
            <span className="misty-store__verified-badge" title="Verified by Misty">
              <ShieldCheck aria-hidden="true" />
            </span>
          ) : null}
        </div>
        <div className="misty-store__compact-meta">
          <span>{author}</span>
          {version ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{version}</span>
            </>
          ) : null}
          {isBuiltin ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="misty-store__builtin-tag">Built-in</span>
            </>
          ) : null}
        </div>
        <small>{entry.overview}</small>
      </div>
      {onSelect ? (
        <button
          aria-label={`View ${entry.name} details`}
          className="misty-store__detail-hitbox"
          onClick={() => onSelect(entry)}
          type="button"
        >
          <span>View {entry.name} details</span>
        </button>
      ) : null}
    </article>
  );
}

function StoreCatalog<T extends StoreSurfaceEntry>({
  categoryOptions,
  description,
  empty,
  entries,
  loading,
  onSelect,
  renderIcon,
  renderPrimaryAction,
  showCategories = false,
  title,
}: StoreChildrenProps<T> & {
  categoryOptions?: { id: CatalogCategory; label: string }[];
  description: string;
  empty: string;
  entries: readonly T[];
  loading: boolean;
  showCategories?: boolean;
  title: string;
}) {
  const [selectedCategory, setSelectedCategory] = useState<CatalogCategory>("all");
  const [page, setPage] = useState(0);

  const filteredEntries = useMemo(() => {
    if (!showCategories || selectedCategory === "all") return entries;
    return entries.filter((entry) => matchesCategory(entry, selectedCategory));
  }, [entries, showCategories, selectedCategory]);

  const pageCount = Math.max(1, Math.ceil(filteredEntries.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * pageSize;
  const visible = filteredEntries.slice(start, start + pageSize);

  useEffect(() => {
    setPage(0);
  }, [entries, selectedCategory]);

  return (
    <section className="misty-store__catalog">
      <div className="misty-store__catalog-header">
        <div className="misty-store__catalog-heading">
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        {showCategories && categoryOptions && entries.length > 0 ? (
          <div aria-label="Filter by category" className="misty-store__filter-chips" role="tablist">
            {categoryOptions.map(({ id, label }) => {
              const active = selectedCategory === id;
              const count =
                id === "all"
                  ? entries.length
                  : entries.filter((entry) => matchesCategory(entry, id)).length;
              if (count === 0 && id !== "all") return null;
              return (
                <button
                  aria-selected={active}
                  className="misty-store__filter-chip"
                  data-active={active ? "true" : "false"}
                  key={id}
                  onClick={() => setSelectedCategory(id)}
                  role="tab"
                  type="button"
                >
                  <span>{label}</span>
                  <span className="misty-store__filter-count">{count}</span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      {loading && filteredEntries.length === 0 ? (
        <div className="misty-store__empty">Loading Store…</div>
      ) : filteredEntries.length === 0 ? (
        <div className="misty-store__empty">
          {selectedCategory !== "all" ? "No apps match the selected category." : empty}
        </div>
      ) : (
        <>
          <div className="misty-store__catalog-grid">
            {visible.map((entry) => (
              <CompactEntry
                entry={entry}
                key={entry.id}
                onSelect={onSelect}
                renderIcon={renderIcon}
                renderPrimaryAction={renderPrimaryAction}
              />
            ))}
          </div>
          {filteredEntries.length > pageSize ? (
            <div className="misty-store__pagination">
              <span>{start + 1}–{Math.min(start + pageSize, filteredEntries.length)} of {filteredEntries.length}</span>
              <div>
                <button
                  aria-label="Previous page"
                  disabled={safePage === 0}
                  onClick={() => setPage((value) => Math.max(0, value - 1))}
                  type="button"
                ><ChevronLeft aria-hidden="true" /></button>
                <button
                  aria-label="Next page"
                  disabled={safePage === pageCount - 1}
                  onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}
                  type="button"
                ><ChevronRight aria-hidden="true" /></button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function clampSidebar(width: number) {
  return Math.min(maxSidebarWidth, Math.max(minSidebarWidth, width));
}

function slug(value: string) {
  return value.toLowerCase().replace(/\s+/g, "-");
}
