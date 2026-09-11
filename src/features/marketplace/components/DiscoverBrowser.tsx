import { compareDiscoverItems } from "./discoverSort";
import { appDownloadKey, useAppDownloads } from "@/features/apps/useAppDownloads";
import { hasTauriInternals } from "@/shared/platform/tauri";
import {
  DiscoverViewControls,
  defaultDiscoverFilters,
  type DiscoverExtraFilters,
  type DiscoverSort,
  type DiscoverAccessFilter,
} from "./DiscoverViewControls";
import type { OfficialApp, SpaceAppInstallation } from "@/api/apps";
import { OfficialAppIcon } from "@/features/apps/OfficialAppIcon";
import {
  Puzzle,
  Download,
  Grid2X2,
  LoaderCircle,
  RefreshCcw,
  Search,
  ShieldCheck,
  Star,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { DiscoverAppDetails } from "./DiscoverAppDetails";
import {
  discoverAppAction,
  discoverAppCategory,
  discoverAppName,
  discoverCategories,
  type DiscoverCategory,
  type DiscoverSection,
} from "./discoverModel";
import { DiscoverAppPreviews } from "./DiscoverAppPreviews";
import "./discover.css";

const sections = [
  { id: "featured", label: "Featured", icon: Star },
  { id: "apps", label: "Apps", icon: Grid2X2 },
  { id: "extensions", label: "Extensions", icon: Puzzle },
  { id: "installed", label: "Downloaded", icon: Download },
] as const;

export interface DiscoverBrowserProps {
  catalog: OfficialApp[];
  installations: SpaceAppInstallation[];
  loading: boolean;
  ready: boolean;
  error: string;
  actionAppId: string;
  mobile: boolean;
  selectedAppId: string;
  reviewPermissions?: boolean;
  requestedSection?: DiscoverSection;
  requestKey?: string;
  onSelect: (id: string) => void;
  onRefresh: () => void;
  onInstall: (app: OfficialApp) => void | Promise<void>;
  onOpen: (app: OfficialApp) => void;
  onRemove: (app: OfficialApp) => void | Promise<void>;
}

export function DiscoverBrowser(props: DiscoverBrowserProps) {
  const [section, setSection] = useState<DiscoverSection>(props.requestedSection ?? "apps");
  const [sort, setSort] = useState<DiscoverSort>("catalog");
  const [accessFilter, setAccessFilter] = useState<DiscoverAccessFilter>("all");
  const [extraFilters, setExtraFilters] = useState<DiscoverExtraFilters>(defaultDiscoverFilters);
  const filtersActive =
    accessFilter !== "all" ||
    extraFilters.download !== "all" ||
    extraFilters.device !== "all" ||
    extraFilters.updates;
  const [category, setCategory] = useState<DiscoverCategory>("All");
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (!props.requestedSection) return;
    setSection(props.requestedSection);
    setCategory("All");
    setQuery("");
  }, [props.requestedSection, props.requestKey]);
  const searchRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const installationById = useMemo(
    () => new Map(props.installations.map((item) => [item.app_id, item])),
    [props.installations],
  );
  const removed = useAppDownloads((state) => state.removed);
  const downloads = useAppDownloads((state) => state.ready);
  const checkDownloads = useAppDownloads((state) => state.check);
  useEffect(() => {
    void checkDownloads(props.catalog);
  }, [props.catalog, checkDownloads]);
  const selected = props.catalog.find((app) => app.id === props.selectedAppId);
  const entries = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const apps = props.catalog.filter((app) => {
      const added = installationById.get(app.id)?.state === "installed";
      const downloaded =
        !removed[app.id] && (hasTauriInternals() ? Boolean(downloads[appDownloadKey(app)]) : added);
      if (extraFilters.download === "downloaded" && !downloaded) return false;
      if (extraFilters.download === "available" && downloaded) return false;
      if (extraFilters.device !== "all" && app[extraFilters.device].runtime === "unsupported")
        return false;
      if (
        extraFilters.updates &&
        !(added && installationById.get(app.id)?.installed_version !== app.version)
      )
        return false;
      if ((accessFilter === "added" && !added) || (accessFilter === "available" && added))
        return false;
      if (
        section === "installed" &&
        !(!removed[app.id] && (hasTauriInternals() ? downloads[appDownloadKey(app)] : added))
      )
        return false;
      return (
        !needle ||
        `${discoverAppName(app)} ${app.name} ${app.description} ${app.publisher} ${discoverAppCategory(app)}`
          .toLowerCase()
          .includes(needle)
      );
    });
    return section === "featured" && !needle && !filtersActive && category === "All"
      ? apps.slice(0, 5)
      : apps;
  }, [
    installationById,
    props.catalog,
    query,
    section,
    accessFilter,
    downloads,
    removed,
    extraFilters,
    filtersActive,
    category,
  ]);
  const visible =
    category === "All"
      ? [...entries]
      : entries.filter((app) => discoverAppCategory(app) === category);
  if (sort !== "catalog") {
    const values = (app: OfficialApp) => ({
      name: discoverAppName(app),
      publisher: app.publisher,
      category: discoverAppCategory(app),
      size: (props.mobile ? app.mobile : app.desktop).download_bytes,
      added: Date.parse(installationById.get(app.id)?.installed_at ?? ""),
    });
    visible.sort((a, b) => compareDiscoverItems(values(a), values(b), sort));
  }
  const title = sections.find((item) => item.id === section)!.label;
  const selectApp = (app: OfficialApp) => {
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    props.onSelect(app.id);
  };
  const empty =
    query.trim() || category !== "All" || filtersActive
      ? {
          title: "No apps found",
          description: "Try another search or adjust your filters.",
        }
      : section === "installed"
        ? {
            title: "Apps added to this Space will appear here",
            description: "Find an app in the catalog and add it to your workspace.",
          }
        : { title: "No apps available yet", description: "Refresh to check the catalog again." };

  return (
    <div className="discover-surface" data-discover-layout>
      <header className="discover-search-band">
        <nav className="discover-nav" aria-label="Discover sections">
          {sections.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className="discover-nav-item"
              aria-current={section === id ? "page" : undefined}
              onClick={() => {
                setSection(id);
                setCategory("All");
                setQuery("");
              }}
            >
              <Icon size={15} strokeWidth={1.8} aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        {section !== "extensions" && (
          <div className="discover-search-controls">
            <label className="discover-search">
              <Search size={16} strokeWidth={1.8} aria-hidden="true" />
              <span className="sr-only">Search Discover</span>
              <input
                ref={searchRef}
                type="search"
                placeholder="Search apps"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setQuery("");
                }}
              />
              {query ? (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => {
                    setQuery("");
                    searchRef.current?.focus();
                  }}
                >
                  <X size={15} aria-hidden="true" />
                </button>
              ) : null}
            </label>
            <DiscoverViewControls
              sort={sort}
              filter={accessFilter}
              onSort={setSort}
              onFilter={setAccessFilter}
              extensions={false}
              extra={extraFilters}
              onExtra={setExtraFilters}
              category={category}
              onCategory={setCategory}
            />
            <button
              type="button"
              className="discover-refresh"
              aria-label="Refresh Discover"
              title="Refresh Discover"
              disabled={props.loading}
              onClick={props.onRefresh}
            >
              <RefreshCcw
                size={16}
                strokeWidth={1.8}
                className={props.loading ? "animate-spin" : undefined}
                aria-hidden="true"
              />
            </button>
          </div>
        )}
      </header>
      <main
        className={`discover-catalog misty-transient-scrollbar${section === "extensions" ? " discover-coming-soon" : ""}`}
        aria-busy={section !== "extensions" && props.loading}
      >
        <h1 className="sr-only">{title}</h1>
        {section === "extensions" ? (
          <div className="discover-empty">
            <h2>Coming soon…</h2>
          </div>
        ) : (
          <>
            {props.ready &&
            !props.error &&
            section !== "installed" &&
            !filtersActive &&
            sort === "catalog" &&
            category === "All" &&
            !query.trim() ? (
              <DiscoverAppPreviews apps={entries} onSelect={selectApp} />
            ) : null}
            {props.catalog.length > 0 && (
              <div className="discover-filters" role="group" aria-label="App categories">
                {discoverCategories.map((item) => (
                  <button
                    type="button"
                    key={item}
                    aria-pressed={category === item}
                    onClick={() => setCategory(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
            )}
            {props.error ? (
              <div className="discover-error" role="alert">
                <p>{props.error}</p>
                <button type="button" disabled={props.loading} onClick={props.onRefresh}>
                  Try again
                </button>
              </div>
            ) : null}
            {!props.ready && props.loading ? (
              <div className="discover-empty" role="status">
                <LoaderCircle size={24} className="animate-spin" aria-hidden="true" />
                <p>Loading apps…</p>
              </div>
            ) : visible.length ? (
              <ul className="discover-app-list" aria-label={`${title} catalog`}>
                {visible.map((app) => {
                  const action = discoverAppAction(app, installationById.get(app.id), props.mobile);
                  const actionLabel =
                    action === "Unavailable"
                      ? action
                      : removed[app.id]
                        ? "Get"
                        : hasTauriInternals()
                          ? downloads[appDownloadKey(app)]
                            ? "Manage"
                            : "Get"
                          : action === "Install"
                            ? "Get"
                            : "Manage";
                  return (
                    <li
                      key={app.id}
                      className="discover-app-row"
                      data-selected={app.id === props.selectedAppId || undefined}
                    >
                      <button
                        type="button"
                        className="discover-app-details-button"
                        aria-label={`View ${discoverAppName(app)} details`}
                        onClick={() => selectApp(app)}
                      >
                        <OfficialAppIcon appId={app.id} size={42} />
                        <span className="discover-app-copy">
                          <span className="discover-app-name">
                            {discoverAppName(app)}
                            {app.official && !props.catalog.every((item) => item.official) ? (
                              <ShieldCheck
                                size={15}
                                className="discover-verified"
                                aria-label="Official Misty app"
                              />
                            ) : null}
                          </span>
                          <span className="discover-app-description">{app.description}</span>
                        </span>
                      </button>
                      <div className="discover-action-group">
                        <button
                          type="button"
                          className={`discover-action ${actionLabel === "Get" ? "discover-action-primary" : ""}`}
                          disabled={Boolean(props.actionAppId) || action === "Unavailable"}
                          aria-label={`${actionLabel} ${discoverAppName(app)}`}
                          onClick={() => selectApp(app)}
                        >
                          {props.actionAppId === app.id
                            ? "Working…"
                            : action === "Unavailable"
                              ? "Unavailable"
                              : actionLabel}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : !props.error ? (
              <div className="discover-empty">
                <h2>{empty.title}</h2>
                <p>{empty.description}</p>
                {section === "installed" && !query && category === "All" && !filtersActive ? (
                  <button
                    type="button"
                    className="discover-action"
                    onClick={() => setSection("apps")}
                  >
                    Browse apps
                  </button>
                ) : query || category !== "All" || filtersActive ? (
                  <button
                    type="button"
                    className="discover-action"
                    onClick={() => {
                      setQuery("");
                      setCategory("All");
                      setAccessFilter("all");
                      setExtraFilters(defaultDiscoverFilters);
                    }}
                  >
                    Clear filters
                  </button>
                ) : (
                  <button
                    type="button"
                    className="discover-action"
                    disabled={props.loading}
                    onClick={props.onRefresh}
                  >
                    {props.loading ? "Refreshing…" : "Refresh catalog"}
                  </button>
                )}
              </div>
            ) : null}
          </>
        )}
      </main>
      <DiscoverAppDetails
        key={`${props.selectedAppId}:${Boolean(props.reviewPermissions)}`}
        reviewPermissions={props.reviewPermissions}
        onAgreed={() => props.onSelect("")}
        app={selected}
        installation={selected ? installationById.get(selected.id) : undefined}
        actionAppId={props.actionAppId}
        mobile={props.mobile}
        error={props.error}
        onClose={() => props.onSelect("")}
        onRestoreFocus={() => {
          const target = returnFocusRef.current;
          if (target?.isConnected) target.focus();
          else searchRef.current?.focus();
        }}
        onInstall={props.onInstall}
        onRemove={props.onRemove}
      />
    </div>
  );
}
