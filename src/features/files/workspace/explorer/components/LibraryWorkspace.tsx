import { MistyFilePicker } from "@/features/picker";
import { SystemErrorActivity } from "@/features/activity";
import { useSmartLibraryStore } from "@/features/library/library";
import type { SearchResult } from "@/native/ipc";
import {
  Button,
  Spinner,
  CollectionHeading,
  CollectionPage,
  CollectionSearch,
  CollectionFilterMenu,
  CollectionFilters,
  CollectionViewToggle,
  CollectionSkeleton,
  EmptyState,
} from "@/shared/ui";
import { BrainCircuit, Plus } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { revealSearchResultInPane, searchResultNavigationTarget } from "../utils/searchNavigation";
import { SmartFolderDialog, createSmartFolderDialogState } from "@/features/file-ui";
import { LibraryDropReviewDialog } from "./LibraryDropReviewDialog";
import { LibraryAssetItems } from "./libraryWorkspace/LibraryAssetItems";
import { LibraryAssetViewer } from "./libraryWorkspace/LibraryGallery";
import { LibraryCollectionsPanel } from "./libraryWorkspace/LibraryCollectionsPanel";
import { LibraryTagChips } from "./libraryWorkspace/LibraryTagChips";
import { MediaLibraryPanel } from "./libraryWorkspace/MediaLibraryPanel";
import { useLibraryAssetFilter } from "./libraryWorkspace/useLibraryAssetFilter";
import { useSemanticAssetSearch } from "./libraryWorkspace/useSemanticAssetSearch";
import { useSmartFolders } from "./libraryWorkspace/useSmartFolders";

export const libraryWorkspacePath = "misty://library";

export function LibraryWorkspace(props: {
  paneId?: string;
  onOpenResult?: (result: SearchResult) => void | Promise<void>;
  /** Rendered as a section inside another page, which owns the title and scrolling. */
  embedded?: boolean;
  renderHeader?: (controls: {
    search: ReactNode;
    actions: ReactNode;
    filterControl: ReactNode;
    viewToggle: ReactNode;
  }) => ReactNode;
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
  const [view, setView] = useState<"list" | "grid">("list");
  const [fileType, setFileType] = useState("all");
  const [sort, setSort] = useState("relevance");
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
  const [pickerOpen, setPickerOpen] = useState(false);

  const selectFiles = () => {
    setPickerOpen(true);
  };

  const typeOf = (asset: (typeof analyzed)[number]) =>
    asset.assetKind || asset.extension.replace(/^\./, "").toUpperCase() || "File";
  const fileTypes = [...new Set(analyzed.map(typeOf))].sort();
  const items = visibleAssets.filter((asset) => fileType === "all" || typeOf(asset) === fileType);
  if (sort !== "relevance")
    items.sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : sort === "name-desc"
          ? b.name.localeCompare(a.name)
          : sort === "size"
            ? b.sizeBytes - a.sizeBytes
            : b.modifiedMs - a.modifiedMs,
    );
  const assetView = tab === "library" || tab === "tags";
  const controls = {
    search: assetView ? (
      <CollectionSearch
        aria-label="Search Smart Library"
        placeholder="Search Smart Library"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
    ) : null,
    actions: (
      <>
        {pendingAnalysisCount > 0 && (
          <Button variant="outline" disabled={analysisBusy} onClick={() => void analyzeFolder()}>
            <BrainCircuit />
            {analysisBusy ? "Analyzing…" : `Analyze ${pendingAnalysisCount.toLocaleString()} ready`}
          </Button>
        )}
        <Button disabled={analysisBusy} onClick={selectFiles}>
          {analysisBusy ? <Spinner label={false} /> : <Plus />}
          {analysisBusy ? "Adding…" : "Add files"}
        </Button>
      </>
    ),
    filterControl: assetView ? (
      <CollectionFilterMenu
        label="Filter and sort Smart Library"
        active={fileType !== "all" || sort !== "relevance"}
        onReset={() => {
          setFileType("all");
          setSort("relevance");
        }}
        groups={[
          {
            label: "File type",
            submenu: true,
            value: fileType,
            options: [
              { value: "all", label: "All types" },
              ...fileTypes.map((value) => ({ value, label: value })),
            ],
            onChange: setFileType,
          },
          {
            label: "Sort by",
            kind: "sort",
            submenu: true,
            value: sort,
            options: [
              { value: "relevance", label: "Relevance" },
              { value: "name", label: "Name A–Z" },
              { value: "name-desc", label: "Name Z–A" },
              { value: "modified", label: "Recently modified" },
              { value: "size", label: "Largest first" },
            ],
            onChange: setSort,
          },
        ]}
      />
    ) : null,
    viewToggle: assetView ? <CollectionViewToggle value={view} onChange={setView} /> : null,
  };
  const sectionOptions = [
    { value: "library", label: "Files" },
    { value: "collections", label: "Collections" },
    { value: "tags", label: "Tags" },
    { value: "media", label: "Media" },
  ];

  const Surface = props.embedded ? "section" : CollectionPage;

  return (
    <Surface
      className={
        props.embedded
          ? "flex min-h-0 min-w-0 flex-1 flex-col gap-4 text-cream"
          : "flex h-full min-h-0 min-w-0 flex-col gap-4 overflow-auto bg-charcoal-workspace px-4 pt-3 pb-5 text-cream sm:px-6"
      }
    >
      {props.renderHeader ? (
        props.renderHeader(controls)
      ) : (
        <>
          <CollectionHeading
            title="Library"
            actions={
              <>
                {controls.search}
                {controls.actions}
              </>
            }
          />
          <CollectionFilters
            options={sectionOptions}
            value={tab}
            onChange={(value) => setTab(value as LibraryTab)}
            filterControl={controls.filterControl}
            actions={controls.viewToggle}
          />
        </>
      )}
      {props.renderHeader && (
        <div
          role="group"
          aria-label="Smart Library sections"
          className="flex flex-wrap gap-1.5 self-start"
        >
          {sectionOptions.map((option) => (
            <Button
              key={option.value}
              variant="chip"
              size="sm"
              className="font-normal"
              aria-pressed={tab === option.value}
              onClick={() => setTab(option.value as LibraryTab)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      )}
      {error && (
        <SystemErrorActivity
          error={error}
          scope="files:library"
          title="Library needs attention"
          target={{ kind: "workspace-tool", tool: "files" }}
        />
      )}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
        {tab === "media" ? <MediaLibraryPanel /> : null}
        {assetView && !loaded ? (
          <CollectionSkeleton label="Loading Smart Library" view={view} />
        ) : null}
        {loaded && assetView ? (
          <>
            {semanticSearching && (
              <p role="status" className="text-sm text-cream-muted">
                Searching file contents…
              </p>
            )}
            {semanticError && (
              <SystemErrorActivity
                error={semanticError}
                scope="files:library:semantic-search"
                title="Semantic search is unavailable"
                target={{ kind: "workspace-tool", tool: "files" }}
              />
            )}
          </>
        ) : null}
        {loaded && tab === "library" ? (
          <>
            <LibraryAssetItems
              assets={items}
              rootPath={library?.rootPath ?? ""}
              view={view}
              sortResetKey={`${sort}:${fileType}:${query}`}
              onOpen={setSelectedAssetId}
            />
            {!items.length && (
              <EmptyState
                title={
                  query || fileType !== "all" || selectedTag
                    ? "No matching files"
                    : "No files in Library"
                }
                description={
                  query || fileType !== "all" || selectedTag
                    ? "Try another search or clear the filters."
                    : "Add local files to analyze and organize them. Originals stay exactly where they are on this device."
                }
                action={
                  query || fileType !== "all" || selectedTag ? (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setQuery("");
                        setFileType("all");
                        setSelectedTag(null);
                      }}
                    >
                      Clear filters
                    </Button>
                  ) : undefined
                }
              />
            )}
          </>
        ) : null}
        {loaded && tab === "tags" ? (
          <>
            <LibraryTagChips
              tags={tags}
              visibleTags={visibleTags}
              tagQuery={tagQuery}
              selectedTag={selectedTag}
              tagsExpanded={tagsExpanded}
              onTagQuery={setTagQuery}
              onSelectTag={setSelectedTag}
              onToggleExpanded={() => setTagsExpanded((current) => !current)}
            />
            <LibraryAssetItems
              assets={items}
              rootPath={library?.rootPath ?? ""}
              view={view}
              sortResetKey={`${sort}:${fileType}:${query}:${selectedTag}`}
              onOpen={setSelectedAssetId}
            />
          </>
        ) : null}
        {tab === "collections" ? (
          <LibraryCollectionsPanel
            savedSearches={savedSearches}
            results={folderResults}
            searching={folderSearching}
            error={folderError}
            onEdit={(search) => setFolderDialog(createSmartFolderDialogState(search))}
            onRun={(search) => void runFolder(search)}
            onOpenResult={(result) =>
              void (props.onOpenResult
                ? props.onOpenResult(result)
                : props.paneId
                  ? revealSearchResultInPane(props.paneId, searchResultNavigationTarget(result))
                  : undefined)
            }
          />
        ) : null}
      </div>
      {folderDialog ? (
        <SmartFolderDialog
          state={folderDialog}
          error={null}
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
      {pickerOpen ? (
        <MistyFilePicker
          mode="file"
          multiple
          title="Add files to Library"
          onCancel={() => setPickerOpen(false)}
          onSelect={(path) => {
            setPickerOpen(false);
            void addFiles([path]);
          }}
          onSelectMany={(paths) => {
            setPickerOpen(false);
            void addFiles(paths);
          }}
        />
      ) : null}
    </Surface>
  );
}

export type LibraryTab = "library" | "collections" | "tags" | "media";
