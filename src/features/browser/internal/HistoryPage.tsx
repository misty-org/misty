import { History, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Checkbox, ListRow, ListRowButton } from "@/shared/ui";
import { browserLibrary, type BrowserHistoryVisit } from "../library/native";
import {
  InternalPageEmpty,
  InternalPageFrame,
  SiteIcon,
} from "./InternalPageFrame";
import type { BrowserInternalPageProps } from "./types";

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
  const [visits, setVisits] = useState<BrowserHistoryVisit[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const load = useCallback(
    async (before?: number) => {
      setLoading(true);
      try {
        const page = await browserLibrary.history({
          profileId: props.profileId,
          text,
          before,
          limit: pageSize,
        });
        setVisits((current) => (before ? [...current, ...page] : page));
        setMore(page.length === pageSize);
        setError(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setLoading(false);
      }
    },
    [props.profileId, text],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), text ? 150 : 0);
    return () => window.clearTimeout(timer);
  }, [load, text]);

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
      icon={History}
      search={{ value: text, placeholder: "Search history", onChange: setText }}
      actions={
        <div className="flex items-center gap-1">
          {selected.size ? (
            <Button variant="toolbar" size="xs"
              onClick={() => void remove([...selected])}
            >
              Delete {selected.size} selected
            </Button>
          ) : null}
          <Button variant="toolbar" size="xs" onClick={props.clearBrowsingData}>
            Clear browsing data…
          </Button>
        </div>
      }
    >
      {error ? <p className="mb-3 text-xs text-red-300">{error}</p> : null}
      {!loading && !visits.length ? (
        <InternalPageEmpty
          title={text ? "No matching pages" : "No history yet"}
          detail={
            text
              ? "Try a different word or part of the address."
              : "Pages you visit in Misty's browser appear here. Pages Misty opens for agent work are not recorded."
          }
        />
      ) : null}
      {groups.map(([label, dayVisits]) => (
        <section key={label} className="mb-5">
          <h2 className="mb-1 px-2 text-xs font-medium text-cream-muted">{label}</h2>
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
                 
                  title={visit.url}
                  onClick={(event) =>
                    event.metaKey || event.ctrlKey
                      ? props.openInNewTab(visit.url)
                      : props.navigate(visit.url)
                  }
                  onAuxClick={(event) => {
                    if (event.button === 1) props.openInNewTab(visit.url);
                  }}
                >
                  <span className="truncate text-sm text-cream-bright">
                    {visit.title || hostOf(visit.url)}
                  </span>
                  <span className="shrink-0 truncate text-xs text-cream-muted">
                    {hostOf(visit.url)}
                  </span>
                </ListRowButton>
                <Button variant="toolbar" size="xs"
                  className="opacity-0 group-hover/row:opacity-100 focus:opacity-100"
                  aria-label={`Remove ${visit.title || visit.url} from history`}
                  title="Remove from history"
                  onClick={() => void remove([visit.id])}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </ListRow>
            ))}
          </ul>
        </section>
      ))}
      {more ? (
        <Button variant="toolbar" size="xs"
          className="mx-auto flex"
          disabled={loading}
          onClick={() => void load(visits[visits.length - 1]?.visitedAt)}
        >
          {loading ? "Loading…" : "Show older"}
        </Button>
      ) : null}
    </InternalPageFrame>
  );
}
