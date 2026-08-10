import { useEffect, useMemo, useRef, useState } from "react";
import { pages } from "../content";
import type { Block, DocPage } from "../content/types";
import { ArrowIcon, CloseIcon, SearchIcon } from "./Icons";

interface SearchDialogProps {
  open: boolean;
  onClose: () => void;
  onNavigate: (path: string) => void;
}

function blockText(block: Block): string {
  switch (block.type) {
    case "paragraph":
    case "code":
      return block.type === "paragraph" ? block.text : block.code;
    case "callout":
      return `${block.title} ${block.text}`;
    case "list":
      return block.items.join(" ");
    case "steps":
      return block.items
        .map((item) => `${item.title} ${item.text} ${item.code ?? ""}`)
        .join(" ");
    case "table":
      return `${block.columns.join(" ")} ${block.rows.flat().join(" ")}`;
  }
}

function searchableText(page: DocPage) {
  return [
    page.title,
    page.eyebrow,
    page.description,
    page.command ?? "",
    ...page.sections.flatMap((section) => [
      section.title,
      ...section.blocks.map(blockText),
    ]),
  ]
    .join(" ")
    .toLowerCase();
}

export function SearchDialog({ open, onClose, onNavigate }: SearchDialogProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (!terms.length) return pages.slice(0, 8);
    return pages
      .map((page) => {
        const haystack = searchableText(page);
        const title = page.title.toLowerCase();
        const matches = terms.filter((term) => haystack.includes(term));
        const score =
          matches.length * 10 +
          terms.filter((term) => title.includes(term)).length * 20;
        return { page, score };
      })
      .filter((result) => result.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 10)
      .map((result) => result.page);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelected(0);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    setSelected(0);
  }, [query]);

  if (!open) return null;

  function choose(page: DocPage) {
    onNavigate(page.path);
    onClose();
  }

  return (
    <div className="search-overlay" role="presentation" onMouseDown={onClose}>
      <div
        className="search-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Search documentation"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="search-input-wrap">
          <SearchIcon />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") onClose();
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setSelected((value) => Math.min(value + 1, results.length - 1));
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setSelected((value) => Math.max(value - 1, 0));
              }
              if (event.key === "Enter" && results[selected]) {
                choose(results[selected]);
              }
            }}
            placeholder="Search commands, flags, environment variables…"
            aria-label="Search documentation"
          />
          <button type="button" onClick={onClose} aria-label="Close search">
            <CloseIcon />
          </button>
        </div>
        <div className="search-results">
          {results.length ? (
            results.map((page, index) => (
              <button
                type="button"
                key={page.path}
                className={index === selected ? "selected" : ""}
                onMouseEnter={() => setSelected(index)}
                onClick={() => choose(page)}
              >
                <span>
                  <small>{page.eyebrow}</small>
                  <strong>{page.title}</strong>
                  <em>{page.description}</em>
                </span>
                <ArrowIcon />
              </button>
            ))
          ) : (
            <div className="search-empty">
              <SearchIcon />
              <strong>No documentation found</strong>
              <span>Try a command, option, or environment variable.</span>
            </div>
          )}
        </div>
        <div className="search-help">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> Navigate
          </span>
          <span>
            <kbd>↵</kbd> Open
          </span>
          <span>
            <kbd>Esc</kbd> Close
          </span>
        </div>
      </div>
    </div>
  );
}
