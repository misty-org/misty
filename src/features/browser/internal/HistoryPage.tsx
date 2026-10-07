import { Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Checkbox,
  CollectionFilters,
  IconButton,
  ListRow,
  ListRowButton,
  CollectionSkeleton,
  WorkspaceSectionLabel,
  SkeletonList,
} from "@/shared/ui";
import { browserLibrary, type BrowserHistoryVisit } from "../library/native";
import { InternalPageEmpty, InternalPageFrame, SiteIcon } from "./InternalPageFrame";
import type { BrowserInternalPageProps } from "./types";
import { historySectionRange, historySections, type HistorySection } from "./historySections";

const pageSize = 150;

function dayLabel(time: number): string {
  const date = new Date(time);
  const today = new Date();
  const start = (value: Date) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((start(today) - start(date)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function HistoryPage(props: BrowserInternalPageProps) {
  const [text, setText] = useState("");
  const [section, setSection] = useState<HistorySection>("all");
  const requestId = useRef(0);
  const invalidateRequests = useCallback(() => {
    requestId.current++;
  }, []);
  const [visits, setVisits] = useState<BrowserHistoryVisit[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const load = useCallback(
    async (before?: number) => {
      const id = ++requestId.current;
      const range = historySectionRange(section);
      setLoading(true);
      try {
        const page = await browserLibrary.history({
          profileId: props.profileId,
          text,
          before: before ?? range.before,
          limit: pageSize,
        });
        if (id !== requestId.current) return;
        // Query from the section's upper bound, then stop paging at its lower bound.
        // This also finds older history beyond the first page of recent visits.
        const visible = page.filter(
          (visit) => range.since === undefined || visit.visitedAt >= range.since,
        );
        setVisits((current) => (before ? [...current, ...visible] : visible));
        setMore(page.length === pageSize && visible.length === page.length);
        setError(null);
      } catch (cause) {
        if (id !== requestId.current) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [props.profileId, text, section],
  );

  useEffect(() => {
    setVisits([]);
    setSelected(new Set());
    setMore(false);
    setError(null);
    setLoading(true);
    const timer = window.setTimeout(() => void load(), text ? 150 : 0);
    return () => {
      window.clearTimeout(timer);
      invalidateRequests();
    };
  }, [invalidateRequests, load, text]);

  const groups = useMemo(() => {
    const byDay = new Map<string, BrowserHistoryVisit[]>();
    for (const visit of visits) {
      const label = dayLabel(visit.visitedAt);
      byDay.set(label, [...(byDay.get(label) ?? []), visit]);
    }
    return [...byDay.entries()];
  }, [visits]);

  const remove = async (ids: number[]) => {
    try {
      await browserLibrary.deleteVisits(ids);
      setVisits((current) => current.filter((visit) => !ids.includes(visit.id)));
      setSelected(new Set());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const toggle = (id: number) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <InternalPageFrame
      title="History"
      search={{ value: text, placeholder: "Search history", onChange: setText }}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {selected.size ? (
            <Button variant="outline" onClick={() => void remove([...selected])}>
              Delete {selected.size} selected
            </Button>
          ) : null}
          <Button variant="outline" onClick={props.clearBrowsingData}>
            Clear browsing data…
          </Button>
        </div>
      }
      toolbar={
        <CollectionFilters
          options={[...historySections]}
          value={section}
          onChange={(value) => setSection(value as HistorySection)}
        />
      }
    >
      {error ? (
        <p role="alert" className="mb-3 text-sm text-cream-muted">
          {error}
        </p>
      ) : null}
      {loading && !visits.length ? (
        <CollectionSkeleton label="Loading history" view="rows" />
      ) : null}
      {!loading && !error && !visits.length ? (
        <InternalPageEmpty
          title={
            text
              ? "No matching pages"
              : section === "all"
                ? "No history yet"
                : "No history in this section"
          }
          detail={
            text
              ? "Try a different word or part of the address."
              : section === "all"
                ? "Pages you visit in Misty's browser appear here. Pages Misty opens for agent work are not recorded."
                : "Choose All to see your complete browsing history."
          }
        />
      ) : null}
      {groups.map(([label, dayVisits]) => (
        <section key={label} className="mb-5">
          <WorkspaceSectionLabel compact>{label}</WorkspaceSectionLabel>
          <ul className="grid">
            {dayVisits.map((visit) => (
              <ListRow key={visit.id}>
                <Checkbox
                  className="shrink-0"
                  aria-label={`Select ${visit.title || visit.url}`}
                  checked={selected.has(visit.id)}
                  onCheckedChange={() => toggle(visit.id)}
                />
                <span className="w-14 shrink-0 text-xs tabular-nums text-cream-muted">
                  {new Date(visit.visitedAt).toLocaleTimeString(undefined, {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
                <SiteIcon url={visit.url} />
                <ListRowButton
                  className="flex-col gap-0.5 @min-[40rem]/browser-page:flex-row @min-[40rem]/browser-page:gap-2"
                  title={visit.url}
                  onClick={(event) =>
                    event.metaKey || event.ctrlKey
                      ? props.openInNewView(visit.url)
                      : props.navigate(visit.url)
                  }
                  onAuxClick={(event) => {
                    if (event.button === 1) props.openInNewView(visit.url);
                  }}
                >
                  <span className="max-w-full truncate text-sm text-cream-bright">
                    {visit.title || hostOf(visit.url)}
                  </span>
                  <span className="max-w-full truncate text-xs text-cream-muted">
                    {hostOf(visit.url)}
                  </span>
                </ListRowButton>
                <IconButton
                  size="xs"
                  label={`Remove ${visit.title || visit.url} from history`}
                  tooltip="Remove from history"
                  className="opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100"
                  onClick={() => void remove([visit.id])}
                >
                  <Trash2 className="size-3.5" />
                </IconButton>
              </ListRow>
            ))}
          </ul>
        </section>
      ))}
      {more && loading && visits.length ? (
        <SkeletonList label="Older history" rows={4} leading="icon" lines={1} rowClassName="px-2" />
      ) : more ? (
        <Button
          variant="toolbar"
          size="xs"
          className="mx-auto flex"
          disabled={loading}
          onClick={() => void load(visits[visits.length - 1]?.visitedAt)}
        >
          Show older
        </Button>
      ) : null}
    </InternalPageFrame>
  );
}
