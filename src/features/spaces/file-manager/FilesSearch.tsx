// Adapted from Kura (MIT, Copyright (c) 2026 Kura contributors). See NOTICE.
import type { LucideIcon } from "lucide-react";
import {
  useEffect,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import { SearchField, SuggestionItem, SuggestionList, Text } from "@misty/ui";
import { disk, type FileEntry } from "@/features/files";
import { itemIcon } from "./FileItems";
import { diskItem, parentOf, type FilesPlace } from "./model";

export interface SearchLocation {
  id: string;
  label: string;
  detail: string;
  icon: LucideIcon | ReactElement;
  place: FilesPlace;
}

export interface SearchSuggest {
  locations: SearchLocation[];
  indexed: boolean;
  onPlace(place: FilesPlace): void;
  onEntry(entry: FileEntry): void;
}

function fuzzy(haystack: string, needle: string) {
  if (haystack.includes(needle)) return true;
  let at = 0;
  for (const letter of needle) {
    at = haystack.indexOf(letter, at);
    if (at === -1) return false;
    at += 1;
  }
  return true;
}

function useIndexHits(query: string, on: boolean) {
  const [hits, setHits] = useState<FileEntry[]>([]);
  useEffect(() => {
    const needle = query.trim();
    setHits([]);
    if (!on || !needle) return;
    let live = true;
    const timer = window.setTimeout(() => {
      void disk.search(needle, null, 8).then(
        (found) => live && setHits(found),
        () => undefined,
      );
    }, 160);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [query, on]);
  return hits;
}

type Row = {
  key: string;
  group: "Locations" | "Files";
  run(): void;
  node: (selected: boolean) => ReactNode;
};

export function FilesSearch({
  query,
  onQuery,
  searchRef,
  label,
  suggest,
}: {
  query: string;
  onQuery(query: string): void;
  searchRef: RefObject<HTMLInputElement | null>;
  label: string;
  suggest?: SearchSuggest;
}) {
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  const needle = query.trim().toLocaleLowerCase();
  const hits = useIndexHits(query, Boolean(suggest?.indexed) && focused);
  useEffect(() => setActive(0), [needle]);

  const close = () => {
    onQuery("");
    setFocused(false);
    searchRef.current?.blur();
  };
  const rows: Row[] = [];
  if (suggest && needle) {
    for (const location of suggest.locations
      .filter((each) => fuzzy(`${each.label} ${each.detail}`.toLocaleLowerCase(), needle))
      .slice(0, 8))
      rows.push({
        key: `place:${location.id}`,
        group: "Locations",
        run: () => {
          suggest.onPlace(location.place);
          close();
        },
        node: (selected) => (
          <SuggestionItem
            selected={selected}
            icon={location.icon}
            label={location.label}
            detail={location.detail}
          />
        ),
      });
    for (const hit of hits)
      rows.push({
        key: `file:${hit.path}`,
        group: "Files",
        run: () => {
          suggest.onEntry(hit);
          close();
        },
        node: (selected) => (
          <SuggestionItem
            selected={selected}
            icon={itemIcon(diskItem(hit))}
            label={hit.name}
            detail={parentOf(hit.path)}
          />
        ),
      });
  }
  const open = focused && rows.length > 0;

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!open) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActive((now) => (now + (event.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      rows[Math.min(active, rows.length - 1)]?.run();
    }
  };

  let group: Row["group"] | null = null;
  return (
    <div className="relative w-64 shrink-0">
      <SearchField
        ref={searchRef}
        aria-label={label}
        aria-expanded={open}
        aria-autocomplete="list"
        role="combobox"
        placeholder="Search"
        framed
        containerClassName="w-full"
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        onClear={() => onQuery("")}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={onKeyDown}
      />
      {open ? (
        <SuggestionList
          aria-label="Search results"
          className="absolute right-0 top-full z-[var(--stack-overlay)] mt-1 max-h-96 w-96 overflow-y-auto"
        >
          {rows.map((row, index) => {
            const heading = row.group !== group;
            group = row.group;
            return (
              <div key={row.key} onClick={row.run}>
                {heading ? (
                  <div className="px-2 pt-2 pb-1">
                    <Text size="caption" tone="muted">
                      {row.group}
                    </Text>
                  </div>
                ) : null}
                {row.node(index === active)}
              </div>
            );
          })}
        </SuggestionList>
      ) : null}
    </div>
  );
}
