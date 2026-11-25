import { invoke } from "@tauri-apps/api/core";
import { Columns2, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ErrorState,
  ListRow,
  ListRowSkeleton,
  MenuItem,
  RowGroupSection,
  RowGroupStack,
  SearchField,
} from "@misty/ui";
import { pageLabel, shownAddress } from "./web_address";

interface Visit {
  url: string;
  title: string;
  lastVisit: number;
}

const pageSize = 100;

function dayOf(time: number) {
  const day = new Date(time);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

function dayName(day: number) {
  const today = dayOf(Date.now());
  if (day === today) return "Today";
  if (day === today - 86_400_000) return "Yesterday";
  return new Date(day).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: new Date(day).getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}

function byDay(visits: Visit[]) {
  const days = new Map<number, Visit[]>();
  for (const visit of visits) {
    const day = dayOf(visit.lastVisit);
    days.set(day, [...(days.get(day) ?? []), visit]);
  }
  return [...days.entries()];
}

const listHistory = (query: string, before?: number) =>
  invoke<Visit[]>("browser_history_list", { request: { query, before, limit: pageSize } });

export function WebHistoryDialog(props: {
  onClose(): void;
  onGo(url: string): void;
  onOpenBeside(url: string): void;
}) {
  const [query, setQuery] = useState("");
  const [visits, setVisits] = useState<Visit[] | null>(null);
  const [more, setMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    setFailed(false);
    void listHistory(query.trim())
      .then((rows) => {
        if (!current) return;
        setVisits(rows);
        setMore(rows.length === pageSize);
      })
      .catch(() => {
        if (current) setFailed(true);
      });
    return () => {
      current = false;
    };
  }, [query, attempt]);

  const showMore = () => {
    const last = visits?.at(-1);
    if (!last) return;
    void listHistory(query.trim(), last.lastVisit)
      .then((rows) => {
        setVisits((current) => [...(current ?? []), ...rows]);
        setMore(rows.length === pageSize);
      })
      .catch(() => setFailed(true));
  };
  const forget = (url: string) => {
    setVisits((current) => current?.filter((visit) => visit.url !== url) ?? null);
    void invoke("browser_history_forget", { request: { url } }).catch(() => undefined);
  };
  const open = (url: string, beside: boolean) => {
    props.onClose();
    if (beside) props.onOpenBeside(url);
    else props.onGo(url);
  };

  return (
    <Dialog open onOpenChange={(next) => !next && props.onClose()}>
      <DialogContent tone="page" size="lg" layout="scroll">
        <DialogHeader>
          <DialogTitle>History</DialogTitle>
          <SearchField
            aria-label="Search history"
            placeholder="Search history"
            containerClassName="ml-auto w-64"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </DialogHeader>
        <DialogBody>
          {failed ? (
            <ErrorState
              title="History couldn't load"
              action={{ label: "Try again", onClick: () => setAttempt((value) => value + 1) }}
            />
          ) : !visits ? (
            <div className="p-4">
              <ListRowSkeleton label="History" rows={8} lines={2} />
            </div>
          ) : !visits.length ? (
            <EmptyState
              title={query.trim() ? "Nothing matches" : "No history yet"}
              line={query.trim() ? "Try other words." : "Pages you visit show up here."}
            />
          ) : (
            <div className="p-4">
              <RowGroupStack>
                {byDay(visits).map(([day, rows]) => (
                  <RowGroupSection key={day} title={dayName(day)}>
                    {rows.map((visit) => (
                      <ListRow
                        key={visit.url}
                        label={pageLabel(visit.url, visit.title)}
                        description={`${shownAddress(visit.url).host}, ${new Date(
                          visit.lastVisit,
                        ).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`}
                        onOpen={(event) => open(visit.url, event.metaKey || event.ctrlKey)}
                        menuLabel={pageLabel(visit.url, visit.title)}
                        menu={
                          <>
                            <MenuItem
                              icon={Columns2}
                              label="Open beside"
                              onSelect={() => open(visit.url, true)}
                            />
                            <MenuItem
                              icon={Trash2}
                              label="Remove from history"
                              danger
                              onSelect={() => forget(visit.url)}
                            />
                          </>
                        }
                      />
                    ))}
                  </RowGroupSection>
                ))}
                {more ? (
                  <Button variant="quiet" onClick={showMore}>
                    Show more
                  </Button>
                ) : null}
              </RowGroupStack>
            </div>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
