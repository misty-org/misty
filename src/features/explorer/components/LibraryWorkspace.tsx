import { Input } from "../../../components/ui/input";
import { Button } from "../../../components/ui/button";
import { Badge } from "../../../components/ui/badge";
import { Dialog, DialogContent, DialogTitle } from "../../../components/ui/dialog";
import { Progress } from "../../../components/ui/progress";
import {
  File,
  Film,
  FolderSearch,
  Images,
  Loader2,
  Music,
  Pause,
  Play,
  Plus,
  Search,
  Sparkles,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  savedSearchesDelete,
  savedSearchesSave,
  savedSearchesSnapshot,
} from "@/services/misty-api/misty";
import type {
  SavedSearch,
  SavedSearchRule,
  SearchResult,
  SmartLibraryAsset,
} from "@/services/misty-api/types";
import { safeTauriAssetUrl } from "@/shared/tauri";
import { useSmartLibraryStore } from "../../../stores/useSmartLibraryStore";
import { useMediaSearchStore } from "../../../stores/useMediaSearchStore";
import { revealSearchResultInPane } from "../utils/searchNavigation";
import {
  mergeHybridSearchResults,
  queryIndexedExplorerSearch,
  querySemanticExplorerSearch,
} from "../utils/globalSearch";
import { searchResultNavigationTarget } from "../utils/searchNavigation";
import {
  createSmartFolderDialogState,
  smartFolderId,
  smartFolderMatchMode,
  smartFolderQueryFromRules,
  smartFolderRulesWithMode,
  sortSavedSearches,
  type SmartFolderDialogState,
  type SmartFolderDraft,
} from "./ExplorerSidebarSupport";
import { SmartFolderDialog } from "./ExplorerSidebarDialogs";
import { SearchResultThumbnail } from "./SearchResultThumbnail";
import { searchResultContext, searchResultSummary } from "./ExplorerToolbarSupport";
import { searchSemanticAssets } from "../../../stores/smartLibraryServerApi";
import { formatBytes, formatDate } from "../utils/fileFormat";
import {
  aggregateLibraryTags,
  DEFAULT_ASSET_TAG_LIMIT,
  DEFAULT_LIBRARY_TAG_LIMIT,
  tagsWithout,
  visibleAssetTags,
  visibleLibraryTags,
} from "../utils/libraryTags";
import { GlobalPreviewDialog } from "./GlobalPreview";
import { LibraryDropReviewDialog } from "./LibraryDropReviewDialog";
import { MediaIndexApprovalDialog, MediaIndexRemovalDialog } from "./MediaIndexDialogs";

export const libraryWorkspacePath = "misty://library";

type LibraryTab = "library" | "collections" | "tags" | "media";

export function LibraryWorkspace(props: {
  paneId: string;
  workingDirectory: string;
  onOpenResult?: (result: SearchResult) => void | Promise<void>;
}) {
  const {
    loaded,
    phase,
    library,
    error,
    pendingDrop,
    load,
    addFiles,
    analyzeFolder,
    setAssetTags,
    confirmDroppedFiles,
    cancelDroppedFiles,
  } = useSmartLibraryStore(
    useShallow((state) => ({
      loaded: state.loaded,
      phase: state.phase,
      library: state.library,
      error: state.error,
      pendingDrop: state.pendingDrop,
      load: state.load,
      addFiles: state.addFiles,
      analyzeFolder: state.analyzeFolder,
      setAssetTags: state.setAssetTags,
      confirmDroppedFiles: state.confirmDroppedFiles,
      cancelDroppedFiles: state.cancelDroppedFiles,
    })),
  );
  const [tab, setTab] = useState<LibraryTab>("library");
  const [query, setQuery] = useState("");
  const [semanticAssetIds, setSemanticAssetIds] = useState<string[] | null>(null);
  const [semanticSearching, setSemanticSearching] = useState(false);
  const [semanticError, setSemanticError] = useState<string | null>(null);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [tagQuery, setTagQuery] = useState("");
  const [tagsExpanded, setTagsExpanded] = useState(false);
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [folderDialog, setFolderDialog] = useState<SmartFolderDialogState>(null);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [folderResults, setFolderResults] = useState<SearchResult[]>([]);
  const [folderSearching, setFolderSearching] = useState(false);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    void savedSearchesSnapshot()
      .then((snapshot) => setSavedSearches(sortSavedSearches(snapshot.searches)))
      .catch(() => undefined);
  }, []);

  const analyzed = useMemo(
    () => library?.assets.filter((asset) => asset.status === "analyzed") ?? [],
    [library],
  );
  const selectedAsset = useMemo(
    () => analyzed.find((asset) => asset.assetId === selectedAssetId) ?? null,
    [analyzed, selectedAssetId],
  );
  const pendingAnalysisCount = library?.preflight.pilotCappedImages ?? 0;
  const analysisBusy = phase === "uploading" || phase === "processing";
  const tags = useMemo(() => aggregateLibraryTags(analyzed), [analyzed]);
  const visibleTags = useMemo(
    () => visibleLibraryTags(tags, { query: tagQuery, expanded: tagsExpanded, selectedTag }),
    [selectedTag, tagQuery, tags, tagsExpanded],
  );
  useEffect(() => {
    if (
      selectedTag &&
      !tags.some((tag) => tag.name.toLocaleLowerCase() === selectedTag.toLocaleLowerCase())
    )
      setSelectedTag(null);
  }, [selectedTag, tags]);
  useEffect(() => {
    const needle = query.trim();
    const folderId = library?.serverFolderId;
    if (!folderId || needle.replace(/\s/g, "").length < 3) {
      setSemanticAssetIds(null);
      setSemanticSearching(false);
      setSemanticError(null);
      return;
    }
    let canceled = false;
    setSemanticSearching(true);
    setSemanticError(null);
    const timer = window.setTimeout(() => {
      void searchSemanticAssets(needle, { folderId, limit: 100 })
        .then((response) => {
          if (canceled) return;
          setSemanticAssetIds(response.hits.map((hit) => hit.assetId));
          setSemanticSearching(false);
        })
        .catch((reason: unknown) => {
          if (canceled) return;
          setSemanticAssetIds(null);
          setSemanticSearching(false);
          setSemanticError(reason instanceof Error ? reason.message : String(reason));
        });
    }, 320);
    return () => {
      canceled = true;
      window.clearTimeout(timer);
    };
  }, [library?.serverFolderId, query]);
  const visibleAssets = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const semanticRank = new Map(
      (semanticAssetIds ?? []).map((assetId, index) => [assetId, index]),
    );
    return analyzed
      .filter((asset) => {
        if (
          selectedTag &&
          !asset.tags.some((tag) => tag.toLocaleLowerCase() === selectedTag.toLocaleLowerCase())
        )
          return false;
        if (!needle) return true;
        const localMatch = [asset.name, asset.description, ...asset.tags, ...asset.collections]
          .filter((value): value is string => Boolean(value))
          .some((value) => value.toLocaleLowerCase().includes(needle));
        return localMatch || semanticRank.has(asset.assetId);
      })
      .sort((left, right) => {
        const leftRank = semanticRank.get(left.assetId);
        const rightRank = semanticRank.get(right.assetId);
        if (leftRank !== undefined || rightRank !== undefined)
          return (leftRank ?? Number.MAX_SAFE_INTEGER) - (rightRank ?? Number.MAX_SAFE_INTEGER);
        return left.name.localeCompare(right.name);
      });
  }, [analyzed, query, selectedTag, semanticAssetIds]);

  const saveFolder = async (draft: SmartFolderDraft) => {
    const search: SavedSearch = {
      id: draft.id || smartFolderId(),
      name: draft.name.trim(),
      query: draft.query.trim() || smartFolderQueryFromRules(draft.rules, draft.matchMode),
      rules: smartFolderRulesWithMode(draft.rules, draft.matchMode),
      updatedAtMs: Date.now(),
    };
    if (!search.name) return;
    try {
      const snapshot = await savedSearchesSave(search);
      setSavedSearches(sortSavedSearches(snapshot.searches));
      setFolderDialog(null);
      setFolderError(null);
    } catch (reason) {
      setFolderError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const deleteFolder = async (id: string) => {
    const snapshot = await savedSearchesDelete(id);
    setSavedSearches(sortSavedSearches(snapshot.searches));
    setFolderDialog(null);
  };
  const runFolder = async (search: SavedSearch) => {
    setFolderSearching(true);
    setFolderError(null);
    try {
      const rules = search.rules.filter((rule) => rule.field !== "__match");
      const mode = smartFolderMatchMode(search.rules);
      const textQuery = searchableRuleText(search.query, rules, mode);
      const indexed = await queryIndexedExplorerSearch(
        textQuery,
        { scope: "everything", limit: 200, rules, matchMode: mode },
        null,
      );
      const semanticQuery = semanticRuleText(textQuery, rules);
      const semantic = semanticQuery
        ? await querySemanticExplorerSearch(semanticQuery, { scope: "everything", limit: 100 })
        : [];
      setFolderResults(
        mergeHybridSearchResults(indexed, semantic, 200).filter((result) =>
          matchesRules(result, rules, mode),
        ),
      );
    } catch (reason) {
      setFolderError(reason instanceof Error ? reason.message : String(reason));
      setFolderResults([]);
    } finally {
      setFolderSearching(false);
    }
  };
  const selectFiles = async () => {
    const selection = await open({
      multiple: true,
      directory: false,
      title: "Add files to Library",
    });
    const paths = typeof selection === "string" ? [selection] : (selection ?? []);
    if (paths.length > 0) await addFiles(paths);
  };

  return (
    <section className="grid h-full min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden bg-background text-foreground">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 px-6 py-5">
        <div>
          <h1 className="m-0 text-2xl font-bold tracking-[-0.03em]">Library</h1>
          <p className="m-0 mt-1 text-sm text-muted-foreground">
            Private, on-device files organized with AI tags, collections, and search.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {pendingAnalysisCount > 0 ? (
            <Button
              variant="outline"
              disabled={analysisBusy}
              type="button"
              onClick={() => void analyzeFolder()}
            >
              <Sparkles size={16} />
              {analysisBusy
                ? "Analyzing…"
                : `Analyze ${pendingAnalysisCount.toLocaleString()} ready`}
            </Button>
          ) : null}
          <Button disabled={analysisBusy} type="button" onClick={() => void selectFiles()}>
            {analysisBusy ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />}
            {analysisBusy ? "Adding…" : "Add files"}
          </Button>
        </div>
      </header>
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-6 py-3">
        {(
          [
            ["library", Images, "Library"],
            ["collections", FolderSearch, "Collections"],
            ["tags", Tag, "Tags"],
            ["media", Film, "Media"],
          ] as const
        ).map(([value, Icon, label]) => (
          <Button
            key={value}
            type="button"
            variant={tab === value ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={tab === value}
            className={tab === value ? undefined : "text-muted-foreground"}
            onClick={() => setTab(value)}
          >
            <Icon size={15} />
            {label}
          </Button>
        ))}
      </div>
      <div className="min-h-0 overflow-auto p-6">
        {tab !== "media" &&
          (!loaded ? (
            <LibraryEmpty
              title="Loading your library…"
              text="Opening the private on-device catalog."
            />
          ) : !library ? (
            <LibraryEmpty
              title="No files in Library"
              text="Add local files to analyze and organize them. Originals stay exactly where they are on this device."
              action={
                <Button onClick={() => void selectFiles()}>
                  <Plus size={15} />
                  Add files
                </Button>
              }
            />
          ) : null)}
        {tab === "media" ? <MediaLibraryPanel /> : null}
        {library && tab === "library" ? (
          <>
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <strong>{analyzed.length} analyzed files</strong>
              </div>
              <div className="flex h-9 w-full min-w-0 items-center gap-2 rounded-md border border-input bg-transparent px-3 sm:w-[360px]">
                <Search className="shrink-0 text-muted-foreground" size={16} />
                <Input
                  aria-label="Search Library"
                  className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-sm leading-none shadow-none focus-visible:ring-0"
                  value={query}
                  placeholder="Search subjects, descriptions, or tags"
                  onChange={(event) => setQuery(event.target.value)}
                />
                {semanticSearching ? (
                  <Loader2 className="shrink-0 animate-spin text-muted-foreground" size={15} />
                ) : null}
              </div>
            </div>
            {semanticError ? (
              <p className="text-sm text-warning">
                Semantic search is unavailable; showing local metadata matches. {semanticError}
              </p>
            ) : null}
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            {query.trim() && !semanticSearching && visibleAssets.length === 0 ? (
              <LibraryEmpty
                title="No matching files"
                text="Try a subject, character, visible phrase, description, or tag."
              />
            ) : (
              <LibraryGallery
                assets={visibleAssets}
                rootPath={library.rootPath}
                onOpen={setSelectedAssetId}
              />
            )}
          </>
        ) : null}
        {library && tab === "tags" ? (
          <>
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="m-0 text-xl font-bold">Tags</h2>
                <p className="m-0 mt-1 text-sm text-muted-foreground">
                  Mika adds tags during analysis. Open a file to review, remove, or add one.
                </p>
              </div>
              <div className="flex h-9 w-full min-w-0 items-center gap-2 rounded-md border border-input bg-transparent px-3 sm:w-[260px]">
                <Search className="shrink-0 text-muted-foreground" size={15} />
                <Input
                  className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-sm leading-none shadow-none focus-visible:ring-0"
                  value={tagQuery}
                  placeholder="Search tags"
                  aria-label="Search tags"
                  onChange={(event) => setTagQuery(event.target.value)}
                />
                {tagQuery ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Clear tag search"
                    className="shrink-0"
                    onClick={() => setTagQuery("")}
                  >
                    <X size={14} />
                  </Button>
                ) : null}
              </div>
            </div>
            <div className="mb-6 flex flex-wrap items-center gap-2">
              <Button
                variant={!selectedTag ? "default" : "outline"}
                size="sm"
                className="rounded-full"
                onClick={() => setSelectedTag(null)}
              >
                All files
              </Button>
              {visibleTags.map((tag) => (
                <Button
                  key={tag.name}
                  variant={
                    selectedTag?.toLocaleLowerCase() === tag.name.toLocaleLowerCase()
                      ? "default"
                      : "outline"
                  }
                  size="sm"
                  className="rounded-full"
                  onClick={() => setSelectedTag(tag.name)}
                >
                  {tag.name} <span className="opacity-60">{tag.count}</span>
                </Button>
              ))}
              {!tagQuery && tags.length > DEFAULT_LIBRARY_TAG_LIMIT ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-full border-dashed text-muted-foreground"
                  aria-expanded={tagsExpanded}
                  onClick={() => setTagsExpanded((current) => !current)}
                >
                  {tagsExpanded ? "Show less" : "Show more"}
                </Button>
              ) : null}
              {tagQuery && visibleTags.length === 0 ? (
                <span className="text-sm text-muted-foreground">No matching tags</span>
              ) : null}
            </div>
            <LibraryGallery
              assets={visibleAssets}
              rootPath={library.rootPath}
              onOpen={setSelectedAssetId}
            />
          </>
        ) : null}
        {tab === "collections" ? (
          <>
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <h2 className="m-0 text-xl font-bold">Collections</h2>
                <p className="m-0 mt-1 text-sm text-muted-foreground">
                  Saved, rule-based views evaluated against the actual file index and AI metadata.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setFolderDialog(createSmartFolderDialogState())}
              >
                <Plus size={15} />
                New
              </Button>
            </div>
            <div className="grid gap-2">
              {savedSearches.map((search) => (
                <div
                  key={search.id}
                  className="flex items-center gap-3 rounded-lg bg-card p-3 shadow-xs ring-1 ring-foreground/10"
                >
                  <Button
                    variant="ghost"
                    className="h-auto min-w-0 flex-1 justify-start py-1 text-left"
                    onClick={() => void runFolder(search)}
                  >
                    <span className="min-w-0">
                      <strong className="block">{search.name}</strong>
                      <small className="block truncate font-normal text-muted-foreground">
                        {search.query ||
                          smartFolderQueryFromRules(
                            search.rules,
                            smartFolderMatchMode(search.rules),
                          )}
                      </small>
                    </span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setFolderDialog(createSmartFolderDialogState(search))}
                  >
                    Edit
                  </Button>
                </div>
              ))}
            </div>
            {folderError ? <p className="text-sm text-destructive">{folderError}</p> : null}
            {folderSearching ? (
              <p className="text-sm text-muted-foreground">Evaluating rules…</p>
            ) : null}
            {folderResults.length > 0 ? (
              <div className="mt-6 grid gap-1">
                <h3 className="mb-2">Results · {folderResults.length}</h3>
                {folderResults.map((result) => (
                  <Button
                    key={`${result.sourceKind}:${result.entry.path}`}
                    variant="ghost"
                    className="grid h-auto min-h-[72px] grid-cols-[52px_minmax(0,1fr)] items-center gap-3 rounded-lg p-2 text-left"
                    onClick={() =>
                      void (props.onOpenResult
                        ? props.onOpenResult(result)
                        : revealSearchResultInPane(
                            props.paneId,
                            searchResultNavigationTarget(result),
                          ))
                    }
                  >
                    <SearchResultThumbnail
                      result={result}
                      className="grid size-[52px] place-items-center overflow-hidden rounded-md bg-muted"
                      imageClassName="size-full object-cover"
                    />
                    <span className="min-w-0">
                      <strong className="block truncate">{result.entry.name}</strong>
                      <span className="block truncate text-sm text-muted-foreground">
                        {searchResultSummary(result)}
                      </span>
                      <small className="block truncate text-muted-foreground/70">
                        {searchResultContext(result)}
                      </small>
                    </span>
                  </Button>
                ))}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
      {folderDialog ? (
        <SmartFolderDialog
          state={folderDialog}
          error={folderError}
          onSave={saveFolder}
          onDelete={deleteFolder}
          onCancel={() => setFolderDialog(null)}
        />
      ) : null}
      {library && selectedAsset ? (
        <LibraryAssetViewer
          asset={selectedAsset}
          rootPath={library.rootPath}
          onClose={() => setSelectedAssetId(null)}
          onSetTags={(tags) => setAssetTags(selectedAsset.assetId, tags)}
        />
      ) : null}
      {pendingDrop ? (
        <LibraryDropReviewDialog
          preflight={pendingDrop}
          busy={phase === "uploading" || phase === "processing"}
          onCancel={cancelDroppedFiles}
          onConfirm={() => void confirmDroppedFiles()}
        />
      ) : null}
    </section>
  );
}

function MediaLibraryPanel() {
  const {
    loaded,
    loading,
    indexingAssetId,
    progress,
    error,
    snapshot,
    pendingApproval,
    scan,
    requestIndex,
    confirmIndex,
    cancelIndexApproval,
    pauseAsset,
    resumeAsset,
    removeAssetIndex,
    clearDeviceIndex,
  } = useMediaSearchStore(
    useShallow((state) => ({
      loaded: state.loaded,
      loading: state.loading,
      indexingAssetId: state.indexingAssetId,
      progress: state.progress,
      error: state.error,
      snapshot: state.snapshot,
      pendingApproval: state.pendingApproval,
      scan: state.scan,
      requestIndex: state.requestIndex,
      confirmIndex: state.confirmIndex,
      cancelIndexApproval: state.cancelIndexApproval,
      pauseAsset: state.pauseAsset,
      resumeAsset: state.resumeAsset,
      removeAssetIndex: state.removeAssetIndex,
      clearDeviceIndex: state.clearDeviceIndex,
    })),
  );
  const [removeTarget, setRemoveTarget] = useState<
    { kind: "asset"; assetId: string; name: string } | { kind: "device" } | null
  >(null);
  const [mutationPending, setMutationPending] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  useEffect(() => {
    if (!loaded) void scan();
  }, [loaded, scan]);
  const eligible =
    snapshot?.assets.filter(
      (asset) => asset.status !== "unsupported" && asset.indexedFingerprint !== asset.fingerprint,
    ) ?? [];
  const confirmRemoval = async () => {
    if (!removeTarget) return;
    setMutationPending(true);
    setMutationError(null);
    try {
      if (removeTarget.kind === "device") await clearDeviceIndex();
      else await removeAssetIndex(removeTarget.assetId);
      setRemoveTarget(null);
    } catch (reason) {
      setMutationError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setMutationPending(false);
    }
  };
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="m-0 text-xl font-bold">Media Search</h2>
          <p className="m-0 mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
            Search spoken words and visual scenes at exact timestamps. Misty indexes only{" "}
            {snapshot?.rootPath ?? "~/Movies"}; original files never leave your Mac.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading || !!indexingAssetId}
            onClick={() => void scan()}
          >
            {loading ? "Scanning…" : "Scan Movies"}
          </Button>
          {eligible.length ? (
            <Button
              type="button"
              size="sm"
              disabled={loading}
              onClick={() => requestIndex(eligible.map((asset) => asset.assetId))}
            >
              Analyze {eligible.length} {eligible.length === 1 ? "file" : "files"}
            </Button>
          ) : null}
          {snapshot?.assets.some((asset) => asset.indexedFingerprint === asset.fingerprint) ? (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={!!indexingAssetId}
              onClick={() => setRemoveTarget({ kind: "device" })}
            >
              Clear index
            </Button>
          ) : null}
        </div>
      </div>
      <div className="rounded-lg bg-muted/40 p-4 text-sm">
        <strong>Private, resumable preparation</strong>
        <p className="m-0 mt-1 text-muted-foreground">
          Misty strips paths and metadata, sends 30-second compressed audio with up to four
          shot-aware 512px frames, and remembers progress across restarts. Each file is limited to
          120 minutes; total minutes are unlimited and always confirmed with a credit estimate.
          Failed or abandoned incomplete indexes are removed from the server after 30 days.
        </p>
      </div>
      {!snapshot?.ffmpegAvailable && loaded ? (
        <p className="rounded-lg bg-warning/10 p-4 text-sm text-warning">
          FFmpeg and FFprobe are required. Install FFmpeg, then scan again.
        </p>
      ) : null}
      {error ? (
        <p className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">{error}</p>
      ) : null}
      {snapshot?.assets.length ? (
        <div className="grid gap-2">
          {snapshot.assets.map((asset) => {
            const busy = indexingAssetId === asset.assetId;
            const current = asset.indexedFingerprint === asset.fingerprint;
            const resumable =
              (asset.status === "paused" || asset.status === "failed") &&
              asset.approvedFingerprint === asset.fingerprint;
            const percent = busy
              ? progress
              : mediaChunkCountForDisplay(asset.durationMs)
                ? asset.nextChunkIndex / mediaChunkCountForDisplay(asset.durationMs)
                : 0;
            return (
              <div
                key={asset.assetId}
                className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-border/60 p-3"
              >
                <span className="grid size-11 place-items-center rounded-md bg-muted">
                  {asset.mediaType === "audio" ? <Music size={20} /> : <Film size={20} />}
                </span>
                <span className="min-w-0">
                  <strong className="block truncate">{asset.name}</strong>
                  <small className="block text-muted-foreground">
                    {formatMediaDuration(asset.durationMs)} · {asset.mediaType} ·{" "}
                    {asset.status === "unsupported"
                      ? asset.failureCode === "duration_limit_exceeded"
                        ? "Over 120-minute limit"
                        : "Unsupported"
                      : busy
                        ? `Analyzing ${Math.round(percent * 100)}%`
                        : asset.status === "paused"
                          ? `Paused at ${Math.round(percent * 100)}%`
                          : asset.status === "failed"
                            ? `Needs attention · ${Math.round(percent * 100)}% saved`
                            : current
                              ? "Searchable"
                              : "Ready to analyze"}
                  </small>
                  {busy || asset.status === "paused" || asset.status === "failed" ? (
                    <Progress className="mt-2 h-1.5" value={Math.max(3, percent * 100)} />
                  ) : null}
                </span>
                <span className="flex items-center gap-2">
                  {busy ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void pauseAsset(asset.assetId)}
                    >
                      <Pause size={13} />
                      Pause
                    </Button>
                  ) : resumable ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void resumeAsset(asset.assetId)}
                    >
                      <Play size={13} />
                      Resume
                    </Button>
                  ) : !current && asset.status !== "unsupported" ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={loading}
                      onClick={() => requestIndex([asset.assetId])}
                    >
                      Analyze
                    </Button>
                  ) : null}
                  {current ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove index for ${asset.name}`}
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() =>
                        setRemoveTarget({ kind: "asset", assetId: asset.assetId, name: asset.name })
                      }
                    >
                      <Trash2 size={14} />
                    </Button>
                  ) : null}
                </span>
              </div>
            );
          })}
        </div>
      ) : loaded && !loading ? (
        <LibraryEmpty
          title="No media found"
          text="Add an audio or video file to ~/Movies, then scan again."
        />
      ) : null}
      {pendingApproval ? (
        <MediaIndexApprovalDialog
          estimate={pendingApproval}
          pending={loading}
          onCancel={cancelIndexApproval}
          onConfirm={() => void confirmIndex()}
        />
      ) : null}
      {removeTarget ? (
        <MediaIndexRemovalDialog
          target={removeTarget}
          pending={mutationPending}
          error={mutationError}
          onCancel={() => {
            setRemoveTarget(null);
            setMutationError(null);
          }}
          onConfirm={() => void confirmRemoval()}
        />
      ) : null}
    </div>
  );
}
function formatMediaDuration(ms: number) {
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
function mediaChunkCountForDisplay(durationMs: number) {
  const full = Math.floor(durationMs / 30_000);
  const remainder = durationMs % 30_000;
  return remainder === 0 ? full : remainder < 5_000 && full > 0 ? full : full + 1;
}

function LibraryGallery(props: {
  assets: SmartLibraryAsset[];
  rootPath: string;
  onOpen: (assetId: string) => void;
}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(170px,1fr))]">
      {props.assets.map((asset) => (
        <LibraryGalleryTile
          key={asset.assetId}
          asset={asset}
          rootPath={props.rootPath}
          onOpen={() => props.onOpen(asset.assetId)}
        />
      ))}
    </div>
  );
}

function LibraryGalleryTile(props: {
  asset: SmartLibraryAsset;
  rootPath: string;
  onOpen: () => void;
}) {
  const preview = libraryAssetPreview(props.asset, props.rootPath);
  return (
    <Button
      type="button"
      variant="ghost"
      className="group block h-auto min-w-0 overflow-hidden rounded-lg bg-card p-0 text-left shadow-xs ring-1 ring-foreground/10 transition hover:-translate-y-0.5 hover:shadow-md"
      aria-label={`View ${props.asset.name}`}
      title={props.asset.name}
      onClick={props.onOpen}
    >
      <span className="relative block aspect-square overflow-hidden bg-muted">
        {preview ? (
          <img
            className="size-full object-cover transition duration-200 group-hover:scale-[1.025]"
            src={preview}
            alt=""
          />
        ) : (
          <span className="grid size-full place-items-center bg-muted text-muted-foreground">
            <File size={34} strokeWidth={1.5} />
          </span>
        )}
        <span className="absolute inset-x-0 bottom-0 block bg-black/75 px-3 py-2.5">
          <strong className="block truncate text-sm text-white">{props.asset.name}</strong>
          <span className="mt-0.5 block truncate text-[11px] text-white/65">
            {props.asset.assetKind ||
              props.asset.extension.replace(/^\./, "").toUpperCase() ||
              "File"}
          </span>
        </span>
      </span>
    </Button>
  );
}

function LibraryAssetViewer(props: {
  asset: SmartLibraryAsset;
  rootPath: string;
  onClose: () => void;
  onSetTags: (tags: string[]) => Promise<void>;
}) {
  const path = joinPath(props.rootPath, props.asset.relativePath);
  return (
    <GlobalPreviewDialog
      source={{
        path,
        name: props.asset.name,
        extension: props.asset.extension,
        mimeType: props.asset.mimeType,
        sizeBytes: props.asset.sizeBytes,
        modifiedMs: props.asset.modifiedMs,
        description: props.asset.description,
        tags: props.asset.tags,
        originalName: props.asset.name,
        readonly: props.asset.sourceKind !== "local",
        remote: props.asset.sourceKind !== "local",
      }}
      onClose={props.onClose}
      onSaveMetadata={(_caption, tags) => props.onSetTags(tags)}
    />
  );
}

function LegacyLibraryAssetViewer(props: {
  asset: SmartLibraryAsset;
  rootPath: string;
  onClose: () => void;
  onSetTags: (tags: string[]) => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState("");
  const [tagsExpanded, setTagsExpanded] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);
  const [tagMutationPending, setTagMutationPending] = useState(false);
  const [tagMutationError, setTagMutationError] = useState<string | null>(null);
  const preview = libraryAssetPreview(props.asset, props.rootPath);
  const displayedTags = visibleAssetTags(props.asset.tags, tagsExpanded);
  const hiddenTagCount = Math.max(0, props.asset.tags.length - DEFAULT_ASSET_TAG_LIMIT);
  const tagControlsDisabled = tagMutationPending || pendingRemoval !== null;
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (pendingRemoval) {
        if (tagMutationPending) return;
        setPendingRemoval(null);
        setTagMutationError(null);
      } else {
        if (tagMutationPending) return;
        props.onClose();
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [pendingRemoval, props.onClose, tagMutationPending]);
  const commit = async () => {
    const tag = value.trim();
    if (!tag) return;
    if (
      props.asset.tags.some(
        (candidate) => candidate.toLocaleLowerCase() === tag.toLocaleLowerCase(),
      )
    ) {
      setTagMutationError(`“${tag}” is already on this file.`);
      return;
    }
    setTagMutationPending(true);
    setTagMutationError(null);
    try {
      await props.onSetTags([...props.asset.tags, tag]);
      setValue("");
      setAdding(false);
      setTagsExpanded(true);
    } catch (reason) {
      setTagMutationError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setTagMutationPending(false);
    }
  };
  const confirmRemoval = async () => {
    if (!pendingRemoval || tagMutationPending) return;
    setTagMutationPending(true);
    setTagMutationError(null);
    try {
      await props.onSetTags(tagsWithout(props.asset.tags, pendingRemoval));
      setPendingRemoval(null);
    } catch (reason) {
      setTagMutationError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setTagMutationPending(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !tagMutationPending) props.onClose();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        className="grid h-[min(860px,calc(100vh-48px))] w-[calc(100%-2rem)] max-w-[1280px] min-h-0 grid-rows-[minmax(0,1fr)_minmax(280px,42%)] gap-0 overflow-hidden rounded-xl bg-card p-0 text-card-foreground lg:grid-cols-[minmax(0,1.55fr)_minmax(330px,0.65fr)] lg:grid-rows-1 [&>[data-slot=dialog-close]]:hidden"
      >
        <div className="relative grid min-h-0 place-items-center overflow-hidden bg-background">
          {preview ? (
            <img
              className="size-full object-contain"
              src={preview}
              alt={props.asset.description || props.asset.name}
            />
          ) : (
            <div className="grid justify-items-center gap-3 text-muted-foreground">
              <File size={72} strokeWidth={1.2} />
              <span>{props.asset.mimeType || "Open with the full reader"}</span>
            </div>
          )}
          <Button
            type="button"
            variant="secondary"
            size="icon"
            disabled={tagMutationPending}
            aria-label="Close image viewer"
            className="absolute right-3 top-3 rounded-full disabled:cursor-wait"
            onClick={props.onClose}
          >
            <X size={18} />
          </Button>
        </div>
        <aside className="min-h-0 overflow-y-auto border-t border-border p-5 lg:border-l lg:border-t-0">
          <div className="grid gap-5">
            <div className="min-w-0">
              <DialogTitle className="m-0 break-words text-xl font-bold tracking-[-0.02em]">
                {props.asset.name}
              </DialogTitle>
              <p className="m-0 mt-1 break-all text-xs text-muted-foreground">
                {props.asset.relativePath}
              </p>
            </div>
            {props.asset.description ? (
              <div>
                <DetailLabel>Description</DetailLabel>
                <p className="m-0 mt-1 text-sm leading-6 text-muted-foreground">
                  {props.asset.description}
                </p>
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-3 rounded-lg bg-muted/40 p-3 text-sm">
              <DetailStat
                label="Type"
                value={props.asset.assetKind || props.asset.mimeType || "File"}
              />
              <DetailStat label="Size" value={formatBytes(props.asset.sizeBytes)} />
              <DetailStat label="Modified" value={formatDate(props.asset.modifiedMs)} />
              <DetailStat
                label="Confidence"
                value={
                  props.asset.confidence === null
                    ? "—"
                    : `${Math.round(props.asset.confidence * 100)}%`
                }
              />
            </div>
            {props.asset.collections.length ? (
              <div>
                <DetailLabel>Collections</DetailLabel>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {props.asset.collections.map((collection) => (
                    <Badge key={collection} variant="secondary" className="rounded-full">
                      {collection}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}
            <div>
              <DetailLabel>Tags</DetailLabel>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {displayedTags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs"
                  >
                    {tag}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={tagControlsDisabled}
                      aria-label={`Remove ${tag}`}
                      className="size-4 opacity-55 hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-25"
                      onClick={() => {
                        setPendingRemoval(tag);
                        setAdding(false);
                        setTagMutationError(null);
                      }}
                    >
                      <X size={11} />
                    </Button>
                  </span>
                ))}
                {hiddenTagCount > 0 ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={tagControlsDisabled}
                    className="h-auto rounded-full border-dashed px-2.5 py-1 text-xs text-muted-foreground"
                    aria-expanded={tagsExpanded}
                    onClick={() => setTagsExpanded((current) => !current)}
                  >
                    {tagsExpanded ? "Show fewer" : `+${hiddenTagCount} more`}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={tagControlsDisabled}
                  className="h-auto rounded-full border-dashed px-2.5 py-1 text-xs"
                  onClick={() => {
                    setAdding(true);
                    setTagMutationError(null);
                  }}
                >
                  <Plus size={11} />
                  Tag
                </Button>
              </div>
              {pendingRemoval ? (
                <div
                  className="mt-3 rounded-lg border border-destructive/25 bg-destructive/10 p-3"
                  role="alertdialog"
                  aria-labelledby="remove-tag-title"
                  aria-describedby="remove-tag-description"
                >
                  <strong className="block text-sm" id="remove-tag-title">
                    Remove “{pendingRemoval}”?
                  </strong>
                  <p
                    className="m-0 mt-1 text-xs leading-5 text-muted-foreground"
                    id="remove-tag-description"
                  >
                    This removes the tag from {props.asset.name}. Other files will keep it.
                  </p>
                  <div className="mt-3 flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={tagMutationPending}
                      onClick={() => {
                        setPendingRemoval(null);
                        setTagMutationError(null);
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      disabled={tagMutationPending}
                      className="disabled:cursor-wait"
                      onClick={() => void confirmRemoval()}
                    >
                      {tagMutationPending ? <Loader2 className="animate-spin" size={13} /> : null}
                      {tagMutationPending ? "Removing…" : "Remove"}
                    </Button>
                  </div>
                </div>
              ) : null}
              {adding ? (
                <form
                  className="mt-3 flex gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void commit();
                  }}
                >
                  <Input
                    autoFocus
                    disabled={tagControlsDisabled}
                    className="h-9 min-w-0 flex-1"
                    value={value}
                    maxLength={40}
                    placeholder="Add one tag"
                    onChange={(event) => setValue(event.target.value)}
                  />
                  <Button size="sm" disabled={tagControlsDisabled} className="disabled:cursor-wait">
                    {tagMutationPending ? <Loader2 className="animate-spin" size={13} /> : null}Add
                  </Button>
                </form>
              ) : null}
              {tagMutationError ? (
                <p className="m-0 mt-2 text-xs leading-5 text-destructive" role="alert">
                  {tagMutationError}
                </p>
              ) : null}
            </div>
          </div>
        </aside>
      </DialogContent>
    </Dialog>
  );
}

function DetailLabel(props: { children: React.ReactNode }) {
  return <strong className="text-xs capitalize text-muted-foreground">{props.children}</strong>;
}
function DetailStat(props: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <span className="block text-[11px] capitalize text-muted-foreground">{props.label}</span>
      <strong className="mt-0.5 block truncate font-medium" title={props.value}>
        {props.value}
      </strong>
    </div>
  );
}
function libraryAssetPreview(asset: SmartLibraryAsset, rootPath: string) {
  return asset.sourceKind === "local" && asset.mimeType.startsWith("image/")
    ? safeTauriAssetUrl(joinPath(rootPath, asset.relativePath))
    : null;
}

function LibraryEmpty(props: { title: string; text: string; action?: React.ReactNode }) {
  return (
    <div className="grid min-h-[420px] place-items-center text-center">
      <div className="grid max-w-md justify-items-center gap-3">
        <Images className="text-muted-foreground" size={34} />
        <h2 className="m-0 text-xl">{props.title}</h2>
        <p className="m-0 text-sm text-muted-foreground">{props.text}</p>
        {props.action}
      </div>
    </div>
  );
}
function aggregateTags(assets: SmartLibraryAsset[]) {
  const counts = new Map<string, { name: string; count: number }>();
  for (const asset of assets)
    for (const tag of new Set(asset.tags)) {
      const key = tag.toLocaleLowerCase();
      const current = counts.get(key);
      counts.set(key, { name: current?.name ?? tag, count: (current?.count ?? 0) + 1 });
    }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
function joinPath(root: string, relative: string) {
  if (/^(?:[A-Za-z]:[\\/]|[\\/]{2}|\/)/.test(relative)) return relative;
  return `${root.replace(/[\\/]+$/, "")}/${relative.replace(/^[\\/]+/, "")}`;
}
function searchableRuleText(query: string, rules: SavedSearchRule[], mode: "all" | "any") {
  if (mode === "any") return "";
  const text = rules
    .filter((rule) => rule.field === "text" && rule.operator !== "is_not")
    .map((rule) => rule.value)
    .join(" ")
    .trim();
  return text || (rules.length === 0 ? query : "");
}
function semanticRuleText(query: string, rules: SavedSearchRule[]) {
  return [
    query,
    ...rules
      .filter(
        (rule) => (rule.field === "tag" || rule.field === "text") && rule.operator !== "is_not",
      )
      .map((rule) => rule.value),
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
}
function matchesRules(result: SearchResult, rules: SavedSearchRule[], mode: "all" | "any") {
  if (!rules.length) return true;
  const matches = rules.map((rule) => matchRule(result, rule));
  return mode === "any" ? matches.some(Boolean) : matches.every(Boolean);
}
function matchRule(result: SearchResult, rule: SavedSearchRule) {
  const entry = result.entry;
  const value = rule.value.trim().toLocaleLowerCase();
  if (!value) return true;
  let candidate = "";
  if (rule.field === "path") candidate = entry.path.toLocaleLowerCase();
  else if (rule.field === "kind") candidate = entry.kind.toLocaleLowerCase();
  else if (rule.field === "extension")
    candidate = entry.extension.replace(/^\./, "").toLocaleLowerCase();
  else if (rule.field === "hidden") return entry.hidden === (value === "true" || value === "yes");
  else if (rule.field === "size")
    return (
      entry.sizeBytes !== null && compareNumber(entry.sizeBytes, parseSize(value), rule.operator)
    );
  else if (rule.field === "modified")
    return (
      entry.modifiedMs !== null && compareNumber(entry.modifiedMs, Date.parse(value), rule.operator)
    );
  else if (rule.field === "tag")
    return (result.match?.tags ?? []).some((tag) =>
      compareText(tag.toLocaleLowerCase(), value, rule.operator),
    );
  else if (rule.field === "text")
    candidate = [entry.name, result.match?.description, ...(result.match?.tags ?? [])]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase();
  else return true;
  return compareText(candidate, value, rule.operator);
}
function compareText(candidate: string, value: string, operator: string) {
  if (operator === "is") return candidate === value;
  if (operator === "is_not") return candidate !== value;
  if (operator === "starts_with") return candidate.startsWith(value);
  if (operator === "ends_with") return candidate.endsWith(value);
  return candidate.includes(value);
}
function compareNumber(candidate: number, target: number, operator: string) {
  if (!Number.isFinite(target)) return false;
  if (operator === "gt" || operator === "after") return candidate > target;
  if (operator === "lt" || operator === "before") return candidate < target;
  if (operator === "is_not") return candidate !== target;
  return candidate === target;
}
function parseSize(value: string) {
  const match = value.match(/^(\d+(?:\.\d+)?)\s*(kb|kib|mb|mib|gb|gib)?$/i);
  if (!match) return Number.NaN;
  const units: Record<string, number> = {
    kb: 1024,
    kib: 1024,
    mb: 1024 ** 2,
    mib: 1024 ** 2,
    gb: 1024 ** 3,
    gib: 1024 ** 3,
  };
  return Number(match[1]) * (units[(match[2] ?? "").toLocaleLowerCase()] ?? 1);
}
