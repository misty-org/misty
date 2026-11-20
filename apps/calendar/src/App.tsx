import { MistyError } from "@misty/sdk";
import type { CalendarEvent } from "@misty/sdk";
import { useEvents } from "@misty/sdk-react";
import { useMemo, useState } from "react";
import { localInput, monthGrid, sameDay, touchesDay } from "./dates";

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const monthName = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" });

function describe(error: unknown): string {
  if (error instanceof MistyError && error.code === "permission_denied")
    return "Calendar isn't allowed to do that in this Space.";
  return error instanceof Error ? error.message : "Something went wrong.";
}

export function App() {
  const today = new Date();
  const [cursor, setCursor] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selected, setSelected] = useState(today);
  const grid = useMemo(() => monthGrid(cursor.getFullYear(), cursor.getMonth()), [cursor]);
  const from = grid[0]!.toISOString();
  const to = new Date(grid[grid.length - 1]!.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const events = useEvents({ from, to });
  const [title, setTitle] = useState("");
  const [starts, setStarts] = useState(() => localInput(new Date(today.getFullYear(), today.getMonth(), today.getDate(), 9)));
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);

  const parsed = useMemo(
    () => (events.value ?? []).map((event) => ({ event, starts: new Date(event.starts_at), ends: new Date(event.ends_at) })),
    [events.value],
  );
  const on = (day: Date) => parsed.filter((item) => touchesDay(item.starts, item.ends, day)).sort((a, b) => a.starts.getTime() - b.starts.getTime());
  const chosen = on(selected);

  const run = async (work: () => Promise<unknown>) => {
    setError("");
    try {
      await work();
    } catch (reason) {
      setError(describe(reason));
    }
  };

  const add = () => {
    const text = title.trim();
    const begin = new Date(starts);
    if (!text || Number.isNaN(begin.getTime())) return;
    setTitle("");
    const end = new Date(begin.getTime() + 60 * 60 * 1000);
    void run(() =>
      events.create({
        title: text,
        description: "",
        location: "",
        starts_at: begin.toISOString(),
        ends_at: end.toISOString(),
        all_day: false,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      }),
    );
  };

  const row = ({ event, starts: begin }: { event: CalendarEvent; starts: Date }) => (
    <li key={event.id} className="card">
      <p className="card-title">{event.title}</p>
      <p className="card-meta">{event.all_day ? "All day" : timeFormat.format(begin)}{event.location ? ` · ${event.location}` : ""}</p>
      <div className="card-actions">
        {removing === event.id ? (
          <>
            <button type="button" className="danger" onClick={() => { setRemoving(null); void run(() => events.remove(event.id)); }}>
              Remove event
            </button>
            <button type="button" onClick={() => setRemoving(null)}>Cancel</button>
          </>
        ) : (
          <button type="button" className="quiet" onClick={() => setRemoving(event.id)}>Remove</button>
        )}
      </div>
    </li>
  );

  return (
    <main className="planner">
      <header className="bar">
        <h1>{monthName.format(cursor)}</h1>
        <div className="add">
          <button type="button" aria-label="Previous month" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}>←</button>
          <button type="button" onClick={() => { setCursor(new Date(today.getFullYear(), today.getMonth(), 1)); setSelected(today); }}>Today</button>
          <button type="button" aria-label="Next month" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}>→</button>
        </div>
      </header>
      {error ? <p role="alert" className="alert">{error}</p> : null}
      {events.error && !events.value ? (
        <p role="alert" className="note">Events couldn't load. {events.error.message}</p>
      ) : (
        <div className="cal">
          <div className="month" role="grid" aria-label={monthName.format(cursor)}>
            {weekdays.map((day) => <span key={day} className="weekday" role="columnheader">{day}</span>)}
            {grid.map((day) => {
              const count = on(day).length;
              const outside = day.getMonth() !== cursor.getMonth();
              return (
                <button
                  key={day.toISOString()}
                  type="button"
                  role="gridcell"
                  aria-selected={sameDay(day, selected)}
                  aria-label={`${dayFormat.format(day)}${count ? `, ${count} events` : ""}`}
                  className={`day${outside ? " outside" : ""}${sameDay(day, today) ? " today" : ""}${sameDay(day, selected) ? " picked" : ""}`}
                  onClick={() => setSelected(day)}
                >
                  <span>{day.getDate()}</span>
                  {count ? <span className="dots" aria-hidden="true">{"•".repeat(Math.min(count, 3))}</span> : null}
                </button>
              );
            })}
          </div>
          <section className="column" aria-label={dayFormat.format(selected)}>
            <h2>{dayFormat.format(selected)}</h2>
            <ul>{chosen.map(row)}</ul>
            {chosen.length === 0 ? <p className="empty">Nothing this day.</p> : null}
            <form className="stack" onSubmit={(event) => { event.preventDefault(); add(); }}>
              <input aria-label="New event" placeholder="Add an event" value={title} maxLength={240} onChange={(event) => setTitle(event.target.value)} />
              <input aria-label="Starts" type="datetime-local" value={starts} onChange={(event) => setStarts(event.target.value)} />
              <button type="submit" className="primary" disabled={!title.trim()}>Add</button>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
