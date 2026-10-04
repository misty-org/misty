import { Button, IconButton, Input } from "@/shared/ui";
import { Search, X } from "lucide-react";
import { DEFAULT_LIBRARY_TAG_LIMIT, type LibraryTagCount } from "../../utils/libraryTags";

/** The Tags section's heading, tag search and tag filter chips. */
export function LibraryTagChips(props: {
  tags: LibraryTagCount[];
  visibleTags: LibraryTagCount[];
  tagQuery: string;
  selectedTag: string | null;
  tagsExpanded: boolean;
  onTagQuery(value: string): void;
  onSelectTag(tag: string | null): void;
  onToggleExpanded(): void;
}) {
  const { tags, visibleTags, tagQuery, selectedTag, tagsExpanded } = props;
  return (
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
            onChange={(event) => props.onTagQuery(event.target.value)}
          />
          {tagQuery ? (
            <IconButton size="xs" label="Clear tag search" onClick={() => props.onTagQuery("")}>
              <X size={14} />
            </IconButton>
          ) : null}
        </div>
      </div>
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Button
          variant="chip"
          size="chip"
          aria-pressed={!selectedTag}
          onClick={() => props.onSelectTag(null)}
        >
          All files
        </Button>
        {visibleTags.map((tag) => (
          <Button
            variant="chip"
            size="chip"
            aria-pressed={selectedTag?.toLocaleLowerCase() === tag.name.toLocaleLowerCase()}
            key={tag.name}
            onClick={() => props.onSelectTag(tag.name)}
          >
            {tag.name} <span className="opacity-60">{tag.count}</span>
          </Button>
        ))}
        {!tagQuery && tags.length > DEFAULT_LIBRARY_TAG_LIMIT ? (
          <Button
            variant="chip"
            size="chip"
            aria-expanded={tagsExpanded}
            onClick={props.onToggleExpanded}
          >
            {tagsExpanded ? "Show less" : "Show more"}
          </Button>
        ) : null}
        {tagQuery && visibleTags.length === 0 ? (
          <span className="text-sm text-cream-muted">No matching tags</span>
        ) : null}
      </div>
    </>
  );
}
