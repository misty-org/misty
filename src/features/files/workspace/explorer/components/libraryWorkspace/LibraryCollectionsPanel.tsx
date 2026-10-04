import { SystemErrorActivity } from "@/features/activity";
import {
  searchResultContext,
  searchResultSummary,
  smartFolderMatchMode,
  smartFolderQueryFromRules,
} from "@/features/file-ui";
import type { SavedSearch, SearchResult } from "@/native/ipc";
import { Button, Pressable } from "@/shared/ui";
import { Plus } from "lucide-react";
import { SearchResultThumbnail } from "../SearchResultThumbnail";

/** Saved rule-based collections and the results of the one last run. */
export function LibraryCollectionsPanel(props: {
  savedSearches: SavedSearch[];
  results: SearchResult[];
  searching: boolean;
  error: string | null;
  /** Opens the collection editor; without a search it creates one. */
  onEdit(search?: SavedSearch): void;
  onRun(search: SavedSearch): void;
  onOpenResult(result: SearchResult): void;
}) {
  return (
    <>
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h2 className="m-0 text-xl font-bold">Collections</h2>
          <p className="m-0 mt-1 text-sm text-cream-muted">
            Saved, rule-based views evaluated against the actual file index and AI metadata.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => props.onEdit()}>
          <Plus size={15} />
          New
        </Button>
      </div>
      <div className="grid gap-2">
        {props.savedSearches.map((search) => (
          <div
            key={search.id}
            className="flex items-center gap-3 rounded-lg bg-charcoal-card p-3 shadow-xs inset-ring-1 inset-ring-cream/10"
          >
            <Button
              variant="ghost"
              className="h-auto min-w-0 flex-1 justify-start py-1 text-left"
              onClick={() => props.onRun(search)}
            >
              <span className="min-w-0">
                <strong className="block">{search.name}</strong>
                <small className="block truncate font-normal text-cream-muted">
                  {search.query ||
                    smartFolderQueryFromRules(search.rules, smartFolderMatchMode(search.rules))}
                </small>
              </span>
            </Button>
            <Button variant="ghost" size="sm" onClick={() => props.onEdit(search)}>
              Edit
            </Button>
          </div>
        ))}
      </div>
      {props.error ? (
        <SystemErrorActivity
          error={props.error}
          scope="files:library:collections"
          title="Library collection needs attention"
          target={{ kind: "workspace-tool", tool: "files" }}
        />
      ) : null}
      {props.searching ? <p className="text-sm text-cream-muted">Evaluating rules…</p> : null}
      {props.results.length > 0 ? (
        <div className="mt-6 grid gap-1">
          <h3 className="mb-2">Results · {props.results.length}</h3>
          {props.results.map((result) => (
            <Pressable
              key={`${result.sourceKind}:${result.entry.path}`}
              className="hover:bg-cream/[0.045] grid min-h-[72px] grid-cols-[52px_minmax(0,1fr)] items-center gap-3 rounded-lg p-2"
              onClick={() => props.onOpenResult(result)}
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
            </Pressable>
          ))}
        </div>
      ) : null}
    </>
  );
}
