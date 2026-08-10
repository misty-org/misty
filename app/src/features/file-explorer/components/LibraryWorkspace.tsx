import { useSmartLibraryStore } from "@/features/space-library";
import type { SearchResult } from "@/services/misty/model/misty-api";
import { Button, Input } from "@/shared/ui";
import { open } from "@tauri-apps/plugin-dialog";
import { Film, FolderSearch, Images, Loader2, Plus, Search, Sparkles, Tag, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { DEFAULT_LIBRARY_TAG_LIMIT } from "../utils/libraryTags";
import { revealSearchResultInPane, searchResultNavigationTarget } from "../utils/searchNavigation";
import { SmartFolderDialog } from "./ExplorerSidebarDialogs";
import {
  createSmartFolderDialogState,
  smartFolderMatchMode,
  smartFolderQueryFromRules,
} from "./ExplorerSidebarSupport";
import { searchResultContext, searchResultSummary } from "./ExplorerToolbarSupport";
import { LibraryDropReviewDialog } from "./LibraryDropReviewDialog";
import { LibraryEmpty } from "./libraryWorkspace/LibraryDetailPrimitives";
import { LibraryAssetViewer, LibraryGallery } from "./libraryWorkspace/LibraryGallery";
import { MediaLibraryPanel } from "./libraryWorkspace/MediaLibraryPanel";
import { useLibraryAssetFilter } from "./libraryWorkspace/useLibraryAssetFilter";
import { useSemanticAssetSearch } from "./libraryWorkspace/useSemanticAssetSearch";
import { useSmartFolders } from "./libraryWorkspace/useSmartFolders";
import { SearchResultThumbnail } from "./SearchResultThumbnail";

export const libraryWorkspacePath = "misty://library";

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
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);

  const analyzed = useMemo(
    () => library?.assets.filter((asset) => asset.status === "analyzed") ?? [],
    [library],
  );
  const [query, setQuery] = useState("");
  const { semanticAssetIds, semanticSearching, semanticError } = useSemanticAssetSearch(
    query,
    library?.serverFolderId ?? undefined,
  );
  const {
    selectedTag,
    setSelectedTag,
    tagQuery,
    setTagQuery,
    tagsExpanded,
    setTagsExpanded,
    tags,
    visibleTags,
    visibleAssets,
  } = useLibraryAssetFilter({ analyzed, query, semanticAssetIds });
  const {
    savedSearches,
    folderDialog,
    setFolderDialog,
    folderError,
    folderResults,
    folderSearching,
    saveFolder,
    deleteFolder,
    runFolder,
  } = useSmartFolders();

  useEffect(() => {
    void load();
  }, [load]);

  const selectedAsset = useMemo(
    () => analyzed.find((asset) => asset.assetId === selectedAssetId) ?? null,
    [analyzed, selectedAssetId],
  );
  const pendingAnalysisCount = library?.preflight.pilotCappedImages ?? 0;
  const analysisBusy = phase === "uploading" || phase === "processing";

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
    <section className="grid h-full min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden bg-charcoal-bg text-cream">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-charcoal-border/60 px-6 py-5">
        <div>
          <h1 className="m-0 text-2xl font-bold tracking-[-0.03em]">Library</h1>
          <p className="m-0 mt-1 text-sm text-cream-muted">
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
      <div className="flex flex-wrap items-center gap-2 border-b border-charcoal-border/60 px-6 py-3">
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
            className={tab === value ? undefined : "text-cream-muted"}
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
              <div className="flex h-9 w-full min-w-0 items-center gap-2 rounded-md border border-charcoal-border bg-transparent px-3 sm:w-[360px]">
                <Search className="shrink-0 text-cream-muted" size={16} />
                <Input
                  aria-label="Search Library"
                  className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-sm leading-none shadow-none focus-visible:ring-0"
                  value={query}
                  placeholder="Search subjects, descriptions, or tags"
                  onChange={(event) => setQuery(event.target.value)}
                />
                {semanticSearching ? (
                  <Loader2 className="shrink-0 animate-spin text-cream-muted" size={15} />
                ) : null}
              </div>
            </div>
            {semanticError ? (
              <p className="text-sm text-sage-fg">
                Semantic search is unavailable; showing local metadata matches. {semanticError}
              </p>
            ) : null}
            {error ? <p className="text-sm text-cream-bright">{error}</p> : null}
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
                <p className="m-0 mt-1 text-sm text-cream-muted">
                  Agents add tags during analysis. Open a file to review, remove, or add one.
                </p>
              </div>
              <div className="flex h-9 w-full min-w-0 items-center gap-2 rounded-md border border-charcoal-border bg-transparent px-3 sm:w-[260px]">
                <Search className="shrink-0 text-cream-muted" size={15} />
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
                  className="rounded-full border-dashed text-cream-muted"
                  aria-expanded={tagsExpanded}
                  onClick={() => setTagsExpanded((current) => !current)}
                >
                  {tagsExpanded ? "Show less" : "Show more"}
                </Button>
              ) : null}
              {tagQuery && visibleTags.length === 0 ? (
                <span className="text-sm text-cream-muted">No matching tags</span>
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
                <p className="m-0 mt-1 text-sm text-cream-muted">
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
                  className="flex items-center gap-3 rounded-lg bg-charcoal-card p-3 shadow-xs inset-ring-1 inset-ring-cream/10"
                >
                  <Button
                    variant="ghost"
                    className="h-auto min-w-0 flex-1 justify-start py-1 text-left"
                    onClick={() => void runFolder(search)}
                  >
                    <span className="min-w-0">
                      <strong className="block">{search.name}</strong>
                      <small className="block truncate font-normal text-cream-muted">
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
            {folderError ? <p className="text-sm text-cream-bright">{folderError}</p> : null}
            {folderSearching ? <p className="text-sm text-cream-muted">Evaluating rules…</p> : null}
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
                      className="grid size-[52px] place-items-center overflow-hidden rounded-md bg-charcoal-card"
                      imageClassName="size-full object-cover"
                    />
                    <span className="min-w-0">
                      <strong className="block truncate">{result.entry.name}</strong>
                      <span className="block truncate text-sm text-cream-muted">
                        {searchResultSummary(result)}
                      </span>
                      <small className="block truncate text-cream-muted/70">
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

export type LibraryTab = "library" | "collections" | "tags" | "media";
