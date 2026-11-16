import { useEffect, useState } from "react";
import { FileText, StickyNote } from "lucide-react";
import { Pressable, SearchField, Skeleton, OverflowFadeText, Surface, Text } from "@/shared/ui";
import type { TutorActions } from "./TutorPage";
import { searchNotebooks, type SearchHit } from "./tutorSearch";
import { useTutorStore } from "./tutorStore";

/**
 * One search box for every notebook, matching words. A result opens its notebook.
 */
export function SearchAll({ actions }: { actions: TutorActions }) {
  const notebooks = useTutorStore((state) => state.notebooks);
  const [query, setQuery] = useState("");
  // A typed search keeps its last answer on screen until the next one arrives; only the first
  // search shows placeholders.
  const [result, setResult] = useState<{ hits: SearchHit[]; byMeaning: boolean }>();
  useEffect(() => {
    const text = query.trim();
    if (text.length < 3) {
      setResult(undefined);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      searchNotebooks(text, controller.signal)
        .then(setResult)
        // A search that fails finds nothing, rather than waiting on screen.
        .catch(() => !controller.signal.aborted && setResult({ hits: [], byMeaning: true }));
    }, 400);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);
  return (
    // It sits in the Lab's bar, and its results drop under it.
    <div className="relative w-56 min-w-0">
      <SearchField
        containerClassName="w-full"
        aria-label="Search notebooks"
        placeholder="Search notebooks"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {query.trim().length >= 3 ? (
        <Surface
          tone="card"
          edge="hairline"
          radius="xl"
          raised
          className="absolute top-full right-0 z-[var(--stack-sticky)] mt-1.5 w-90 max-w-[calc(100vw-2rem)] flex max-h-105 flex-col gap-0.5 overflow-auto p-1.5"
          role="listbox"
          aria-label="Results"
        >
          {!result ? (
            // A result's own shape: its icon, title and notebook, then two lines of snippet.
            [0, 1, 2].map((index) => (
              <div
                key={index}
                className="flex flex-col items-stretch gap-1 px-2.5 py-2"
                aria-hidden="true"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Skeleton className="size-4 shrink-0 rounded-sm" />
                  <span className="flex h-4.5 items-center">
                    <Skeleton className={index % 2 ? "h-3 w-32" : "h-3 w-44"} />
                  </span>
                  <Skeleton className="h-2.5 w-20 shrink-0" />
                </span>
                <span className="grid">
                  <span className="flex h-4 items-center">
                    <Skeleton className="h-2.5 w-full" />
                  </span>
                  <span className="flex h-4 items-center">
                    <Skeleton className="h-2.5 w-3/4" />
                  </span>
                </span>
              </div>
            ))
          ) : result?.hits.length ? (
            result.hits.map((hit) => (
              <Surface
                as={Pressable}
                key={`${hit.notebookId}:${hit.itemId}`}
                tone="none"
                radius="lg"
                wash="control"
                role="option"
                className="flex flex-col items-stretch gap-1 px-2.5 py-2 text-left"
                onClick={() => actions.open(`notebook:${hit.notebookId}`)}
              >
                <Text bare size="meta" tone="default" className="flex min-w-0 items-center gap-2">
                  <Text bare tone="muted" className="flex flex-none">
                    {hit.kind === "note" ? <StickyNote /> : <FileText />}
                  </Text>
                  <OverflowFadeText>{hit.title}</OverflowFadeText>
                  <Text size="caption" tone="muted" className="flex-none">
                    {notebooks[hit.notebookId]?.title}
                  </Text>
                </Text>
                <Text size="caption" tone="muted" lines={2}>
                  {hit.text.slice(0, 220)}
                </Text>
              </Surface>
            ))
          ) : (
            <Text as="p" size="meta" tone="muted" wrap className="px-0.5 py-4.5">
              Nothing found.
            </Text>
          )}
        </Surface>
      ) : null}
    </div>
  );
}
