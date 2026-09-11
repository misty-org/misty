import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "@/features/app-shell";
import { useProvidersStore } from "@/features/providers";
import { useSettingsStore, selectAdvancedPreferences, selectGeneralPreferences } from "@/features/settings";
import { devicesSnapshot, explorerListDirectory } from "@/features/files/native";
import { FileBrowserView } from "@/features/files/explorer/components/FileBrowserView";
import { FileBrowserRuntimeProvider } from "@/features/files/explorer/components/fileBrowser/FileBrowserRuntime";
import { ExplorerPickerToolbar } from "@/features/files/explorer/components/ExplorerPickerToolbar";
import { useExplorerStore } from "@/features/files/explorer/store";
import type { ExplorerSortState } from "@/features/files/explorer/store";
import type { DirectoryListing, MountedDevice, ProviderRemote } from "@/native/contracts";
import { PickerPlaces } from "./PickerPlaces";
import { resolveMountRoot, resolvePreferredRoot } from "./filePickerPaths";

export interface PickerBrowserState { listing: DirectoryListing | null; selectedIds: string[]; loading: boolean }
const noAction = () => {};
const runtime = {
  thumbnailPreviewsEnabled: false, compactModeEnabled: false,
  prewarmThumbnails: noAction, requestThumbnail: () => noAction,
  Error: ({error}: {error: string}) => <div role="alert" className="p-4 text-cream-muted">{error}</div>,
};

/** Selection is a shell primitive. It does not mount the Files workspace,
 * create workspace tabs, or expose editing and extension execution controls. */
export function PickerFileBrowser({state, onChange, initialPath, multiple, remotes}: {
  state: PickerBrowserState; onChange(state: PickerBrowserState): void;
  initialPath?: string | null; multiple: boolean; remotes: ProviderRemote[];
}) {
  const app = useAppStore(s => s.app);
  const preferences = useSettingsStore(s => s.settings?.document);
  const pinnedPaths = useExplorerStore(s => s.pinnedPaths);
  const home = resolvePreferredRoot(selectGeneralPreferences(preferences).preferredWorkspaceRoot, app?.environment.homeDir ?? "/");
  const mount = resolveMountRoot(home, selectAdvancedPreferences(preferences).mountPath || app?.environment.mountPath || ".misty/mnt");
  const [devices, setDevices] = useState<MountedDevice[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState(""), [hidden, setHidden] = useState(false);
  const [sort, setSort] = useState<ExplorerSortState>({column:"name", direction:"asc"});
  const [history, setHistory] = useState<{paths:string[]; index:number}>({paths:[], index:-1});
  const sequence = useRef(0), anchor = useRef<string | null>(null);
  const current = useRef({state, onChange, history}); current.current = {state, onChange, history};
  const load = useCallback(async (path: string | null, historyIndex?: number) => {
    const ticket = ++sequence.current;
    setLoading(true); setError(null);
    current.current.state = {...current.current.state, selectedIds:[], loading:true};
    current.current.onChange(current.current.state);
    try {
      const listing = await explorerListDirectory({path, showHidden:hidden});
      if (ticket !== sequence.current) return;
      current.current.state = {listing,selectedIds:[],loading:false};
      current.current.onChange(current.current.state); anchor.current = null;
      setHistory(previous => historyIndex !== undefined ? {...previous, index:historyIndex} :
        previous.paths[previous.index] === listing.path ? previous :
          {paths:[...previous.paths.slice(0, previous.index + 1), listing.path], index:previous.index + 1});
    } catch (error) { if (ticket === sequence.current) setError(String(error)); }
    finally { if (ticket === sequence.current) { setLoading(false); current.current.onChange({...current.current.state,loading:false}); } }
  }, [hidden]);
  useEffect(() => {
    void load(current.current.state.listing?.path || initialPath || home);
    return () => { sequence.current++; };
  }, [load, initialPath, home]);
  useEffect(() => {
    let active = true;
    void devicesSnapshot().then(value => { if (active) setDevices(value.devices); }).catch(noAction);
    void useProvidersStore.getState().load().catch(noAction);
    return () => { active = false; };
  }, []);
  const listing = useMemo(() => {
    if (!state.listing) return null;
    const direction = sort.direction === "asc" ? 1 : -1;
    return {...state.listing, entries:[...state.listing.entries].sort((a,b) => {
      if (a.kind !== b.kind && (a.kind === "folder" || b.kind === "folder")) return a.kind === "folder" ? -1 : 1;
      const value = sort.column === "size" ? (a.sizeBytes ?? 0) - (b.sizeBytes ?? 0) : sort.column === "modified" ? (a.modifiedMs ?? 0) - (b.modifiedMs ?? 0) :
        sort.column === "type" ? a.extension.localeCompare(b.extension) : a.name.localeCompare(b.name, undefined, {numeric:true});
      return direction * value;
    })};
  }, [state.listing, sort]);
  const path = state.listing?.path ?? home;
  return <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
    <ExplorerPickerToolbar path={path} query={query} canGoBack={history.index > 0} canGoForward={history.index + 1 < history.paths.length}
      canGoParent={Boolean(state.listing?.parentPath)} onBack={() => void load(history.paths[history.index-1],history.index-1)}
      onForward={() => void load(history.paths[history.index+1],history.index+1)} onParent={() => { if (state.listing?.parentPath) void load(state.listing.parentPath); }}
      onNavigate={path => void load(path)} onRefresh={() => void load(path,history.index)} onQueryChange={setQuery} />
    <div className="grid min-h-0 grid-cols-[180px_minmax(0,1fr)] max-[560px]:grid-cols-1">
      <aside className="min-h-0 overflow-auto border-r border-charcoal-border max-[560px]:hidden"><PickerPlaces homePath={home} activePath={path} mountRoot={mount}
        remotes={remotes} remoteLoading={false} devices={devices} devicesLoading={false} pinnedPaths={pinnedPaths} onNavigate={path => void load(path)} /></aside>
      <FileBrowserRuntimeProvider value={runtime}><FileBrowserView paneId="shell-file-picker" listing={listing} selectedIds={state.selectedIds}
        loading={loading} error={error} viewMode="list" sort={sort} showHidden={hidden} commandQuery={query} commandQueryMode="filter"
        directorySizes={{}} cutPaths={new Set()} inlineEdit={null} selectionOnly
        onSort={column => setSort(previous => ({column,direction:previous.column === column && previous.direction === "asc" ? "desc" : "asc"}))}
        onToggleHidden={() => setHidden(value => !value)} onSelect={(id,event,visible) => {
          let selectedIds = [id];
          if (multiple && event.shiftKey && anchor.current && visible.includes(anchor.current)) {
            const from = visible.indexOf(anchor.current), to = visible.indexOf(id); selectedIds = visible.slice(Math.min(from,to),Math.max(from,to)+1);
          } else if (multiple && (event.metaKey || event.ctrlKey)) selectedIds = state.selectedIds.includes(id) ? state.selectedIds.filter(value => value !== id) : [...state.selectedIds,id];
          else anchor.current = id;
          onChange({...state,selectedIds});
        }} onClearSelection={() => onChange({...state,selectedIds:[]})}
        onOpen={entry => { if (entry.kind === "folder") void load(entry.path); else onChange({...state,selectedIds:[entry.id]}); }}
        onContextMenu={event => event.preventDefault()} onBackgroundContextMenu={event => event.preventDefault()} onDropItems={noAction}
        onInlineEditChange={noAction} onInlineEditCommit={noAction} onInlineEditCancel={noAction} /></FileBrowserRuntimeProvider>
    </div>
  </div>;
}
