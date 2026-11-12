import { useEffect, useState } from "react";
import { FileText, StickyNote } from "lucide-react";
import { Pressable, SearchField, Skeleton, OverflowFadeText } from "@/shared/ui";
import type { TutorActions } from "./TutorPage";
import { searchNotebooks, type SearchHit } from "./tutorSearch";
import { useTutorStore } from "./tutorStore";

/**
 * One search box for every notebook: by meaning with an embedding model on this computer, by words
 * without one. A result opens its notebook.
 */
export function SearchAll({ actions }: { actions: TutorActions }) {
  const notebooks = useTutorStore((state) => state.notebooks);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<{ hits: SearchHit[]; byMeaning: boolean }>();
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    const text = query.trim();
    if (text.length < 3) {
      setResult(undefined);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearching(true);
      searchNotebooks(text, controller.signal)
        .then(setResult)
        .catch(() => undefined)
        .finally(() => !controller.signal.aborted && setSearching(false));
    }, 400);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);
  return (
    <div className="tutor-search-all">
      <SearchField
        containerClassName="tutor-search"
        aria-label="Search all notebooks"
        placeholder="Search all notebooks"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {query.trim().length >= 3 ? (
        <div className="tutor-search-results" role="listbox" aria-label="Results">
          {searching && !result ? (
            [0, 1, 2].map((index) => (
              <div key={index} className="tutor-row" aria-hidden="true">
                <Skeleton className="h-3 w-64" />
              </div>
            ))
          ) : result?.hits.length ? (
            result.hits.map((hit) => (
              <Pressable
                key={`${hit.notebookId}:${hit.itemId}`}
                role="option"
                className="tutor-search-hit"
                onClick={() => actions.open(`notebook:${hit.notebookId}`)}
              >
                <span className="tutor-row-lead">
                  {hit.kind === "note" ? <StickyNote size={14} /> : <FileText size={14} />}
                  <OverflowFadeText>{hit.title}</OverflowFadeText>
                  <OverflowFadeText className="tutor-card-detail">
                    {notebooks[hit.notebookId]?.title}
                  </OverflowFadeText>
                </span>
                <span className="tutor-search-snippet">{hit.text.slice(0, 220)}</span>
              </Pressable>
            ))
          ) : (
            <p className="tutor-empty">Nothing found.</p>
          )}
          {result && !result.byMeaning ? (
            <p className="tutor-card-detail tutor-search-mode">
              Matched by words. Choose an embedding model in Settings → Models to search by meaning.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
