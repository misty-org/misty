import type { OfficialApp, UserAppInstallation } from "@/api/apps";
import { OfficialAppIcon } from "@/features/apps/OfficialAppIcon";
import {
  Download,
  GripVertical,
  LayoutGrid,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCcw,
  Search,
  ShieldCheck,
  SquareStar,
  X,
} from "lucide-react";
import { useId, useMemo, useRef, useState, type CSSProperties } from "react";
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
  { id: "featured", label: "Featured", icon: SquareStar },
  { id: "apps", label: "Apps", icon: LayoutGrid },
  { id: "installed", label: "Installed", icon: Download },
] as const;

const defaultSidebarWidth = 176;
const minSidebarWidth = 160;
const maxSidebarWidth = 320;
const clampSidebarWidth = (width: number) =>
  Math.min(maxSidebarWidth, Math.max(minSidebarWidth, width));

export interface DiscoverBrowserProps {
  catalog: OfficialApp[];
  installations: UserAppInstallation[];
  loading: boolean;
  ready: boolean;
  error: string;
  actionAppId: string;
  mobile: boolean;
  selectedAppId: string;
  onSelect: (id: string) => void;
  onRefresh: () => void;
  onInstall: (app: OfficialApp) => void;
  onOpen: (app: OfficialApp) => void;
  onRemove: (app: OfficialApp) => void;
}

export function DiscoverBrowser(props: DiscoverBrowserProps) {
  const sidebarId = useId();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(defaultSidebarWidth);
  const [resizingSidebar, setResizingSidebar] = useState(false);
  const sidebarDrag = useRef<{ x: number; width: number } | null>(null);
  const [section, setSection] = useState<DiscoverSection>("apps");
  const [category, setCategory] = useState<DiscoverCategory>("All Apps");
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const installationById = useMemo(
    () => new Map(props.installations.map((item) => [item.app_id, item])),
    [props.installations],
  );
  const installedCount = props.installations.filter((item) => item.state === "installed").length;
  const selected = props.catalog.find((app) => app.id === props.selectedAppId);
  const entries = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const apps = props.catalog.filter((app) => {
      if (section === "installed" && installationById.get(app.id)?.state !== "installed")
        return false;
      return (
        !needle ||
        `${discoverAppName(app)} ${app.name} ${app.description} ${app.publisher} ${discoverAppCategory(app)}`
          .toLowerCase()
          .includes(needle)
      );
    });
    return section === "featured" && !needle ? apps.slice(0, 5) : apps;
  }, [installationById, props.catalog, query, section]);
  const visible =
    category === "All Apps"
      ? entries
      : entries.filter((app) => discoverAppCategory(app) === category);
  const title = sections.find((item) => item.id === section)!.label;
  const selectApp = (app: OfficialApp) => {
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    props.onSelect(app.id);
  };
  const empty =
    query.trim() || category !== "All Apps"
      ? {
          title: "No apps found",
          description: "Try another search or choose a different category.",
        }
      : section === "installed"
        ? {
            title: "Your apps will appear here",
            description: "Find an app in the catalog and add it to your workspace.",
          }
        : { title: "No apps available yet", description: "Refresh to check the catalog again." };

  return (
    <div
      className="discover-surface"
      data-discover-layout
      data-resizing-sidebar={resizingSidebar || undefined}
      style={{ "--discover-sidebar-width": `${sidebarWidth}px` } as CSSProperties}
    >
      <div className="discover-layout">
        <nav
          id={sidebarId}
          className="discover-nav"
          aria-label="Discover sections"
          hidden={!sidebarOpen}
        >
          {sections.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className="discover-nav-item"
              aria-current={section === id ? "page" : undefined}
              onClick={() => {
                setSection(id);
                setCategory("All Apps");
                setQuery("");
              }}
            >
              <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
              <span>{label}</span>{" "}
              {id === "installed" ? (
                <span
                  className="discover-nav-count"
                  aria-label={`${installedCount} installed apps`}
                >
                  {installedCount}
                </span>
              ) : null}
            </button>
          ))}
          <div
            className="discover-nav-resizer"
            role="separator"
            aria-label="Resize Discover sidebar"
            aria-orientation="vertical"
            aria-controls={sidebarId}
            aria-valuemin={minSidebarWidth}
            aria-valuemax={maxSidebarWidth}
            aria-valuenow={sidebarWidth}
            tabIndex={0}
            title="Drag to resize · Double-click to reset"
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              sidebarDrag.current = { x: event.clientX, width: sidebarWidth };
              event.currentTarget.setPointerCapture(event.pointerId);
              setResizingSidebar(true);
            }}
            onPointerMove={(event) => {
              const drag = sidebarDrag.current;
              if (drag) setSidebarWidth(clampSidebarWidth(drag.width + event.clientX - drag.x));
            }}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            }}
            onLostPointerCapture={() => {
              sidebarDrag.current = null;
              setResizingSidebar(false);
            }}
            onDoubleClick={() => setSidebarWidth(defaultSidebarWidth)}
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              setSidebarWidth((width) =>
                event.key === "Home"
                  ? minSidebarWidth
                  : event.key === "End"
                    ? maxSidebarWidth
                    : clampSidebarWidth(width + (event.key === "ArrowLeft" ? -8 : 8)),
              );
            }}
          >
            <GripVertical size={12} aria-hidden="true" />
          </div>
        </nav>
        <div className="discover-content">
          <header className="discover-search-band">
            <div className="discover-catalog-heading">
              <div className="discover-title-line">
                <h1>{title}</h1>
                <span>{visible.length}</span>
              </div>
              <p>
                {section === "installed"
                  ? "The apps in your workspace."
                  : section === "featured"
                    ? "A closer look at the tools in Misty."
                    : "Choose what belongs in your workspace."}
              </p>
            </div>
            <div className="discover-search-controls">
              <label className="discover-search">
                <Search size={18} strokeWidth={1.8} aria-hidden="true" />
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
              <button
                type="button"
                className="discover-refresh"
                aria-label="Refresh Discover"
                title="Refresh Discover"
                disabled={props.loading}
                onClick={props.onRefresh}
              >
                <RefreshCcw
                  size={18}
                  strokeWidth={1.8}
                  className={props.loading ? "animate-spin" : undefined}
                  aria-hidden="true"
                />
              </button>
            </div>
          </header>
          <main className="discover-catalog misty-transient-scrollbar" aria-busy={props.loading}>
            {props.ready &&
            !props.error &&
            section !== "installed" &&
            category === "All Apps" &&
            !query.trim() ? (
              <DiscoverAppPreviews apps={entries} onSelect={selectApp} />
            ) : null}
            <div className="discover-filters" role="group" aria-label="App categories">
              {discoverCategories.map((item) => (
                <button
                  type="button"
                  key={item}
                  aria-pressed={category === item}
                  onClick={() => setCategory(item)}
                >
                  {item}{" "}
                  <span>
                    {item === "All Apps"
                      ? entries.length
                      : entries.filter((app) => discoverAppCategory(app) === item).length}
                  </span>
                </button>
              ))}
            </div>
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
                          className={`discover-action ${action === "Add" ? "discover-action-primary" : ""}`}
                          disabled={Boolean(props.actionAppId) || action === "Unavailable"}
                          aria-label={`${action} ${discoverAppName(app)}`}
                          onClick={() => (action === "Open" ? props.onOpen(app) : selectApp(app))}
                        >
                          {props.actionAppId === app.id
                            ? "Working…"
                            : action === "Unavailable"
                              ? "Unavailable"
                              : action}
                        </button>
                        {action === "Review" ? (
                          <span className="discover-review-note">
                            {app.scopes.some(
                              (scope) =>
                                !installationById.get(app.id)?.granted_scopes.includes(scope),
                            )
                              ? "New permissions"
                              : "Access changed"}
                          </span>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : !props.error ? (
              <div className="discover-empty">
                <LayoutGrid size={28} strokeWidth={1.5} aria-hidden="true" />
                <h2>{empty.title}</h2>
                <p>{empty.description}</p>
                {section === "installed" && !query && category === "All Apps" ? (
                  <button
                    type="button"
                    className="discover-action"
                    onClick={() => setSection("apps")}
                  >
                    Browse apps
                  </button>
                ) : query || category !== "All Apps" ? (
                  <button
                    type="button"
                    className="discover-action"
                    onClick={() => {
                      setQuery("");
                      setCategory("All Apps");
                    }}
                  >
                    Clear filters
                  </button>
                ) : null}
              </div>
            ) : null}
          </main>
        </div>
      </div>
      <footer className="discover-bottom-bar" aria-label="Discover controls">
        <button
          type="button"
          aria-label={sidebarOpen ? "Hide Discover sidebar" : "Show Discover sidebar"}
          title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
          aria-expanded={sidebarOpen}
          aria-controls={sidebarId}
          onClick={() => setSidebarOpen((open) => !open)}
        >
          {sidebarOpen ? (
            <PanelLeftClose size={16} aria-hidden="true" />
          ) : (
            <PanelLeftOpen size={16} aria-hidden="true" />
          )}
        </button>
        <span>
          {visible.length} {visible.length === 1 ? "app" : "apps"}
        </span>
      </footer>
      <DiscoverAppDetails
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
        onOpen={props.onOpen}
        onInstall={props.onInstall}
        onRemove={props.onRemove}
      />
    </div>
  );
}
