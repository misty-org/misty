import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState, type FormEvent } from "react";
import { Button, Input } from "@/shared/ui";
import { DictationPill } from "@/features/voice";
import "./desktopOverlay.css";

/**
 * Misty's windows while it controls the desktop or its own window on Windows
 * (src-tauri/src/infra/desktop_overlays_windows.rs): the control island, and
 * the mist that rings what Misty controls and carries its own pointer. The
 * window's label says which this page is. The agent dock's stack shares the
 * page (agent_dock_windows.rs): live thumbnails of docked agent windows,
 * drawn by Windows over the cards this page lays out.
 */
export function DesktopOverlayRoot() {
  const label = getCurrentWindow().label;
  if (label === "misty-desktop-island") return <DesktopIsland />;
  if (label === "misty-dock-stack") return <DockStack />;
  if (label === "misty-dictation-pill") return <DictationPill />;
  return <DesktopMist />;
}

/** Listens for `event` and also reads the current state once, so a page that
 * loads after an update still shows it. */
function useOverlayState<T>(event: string, initial: T) {
  const [state, setState] = useState(initial);
  useEffect(() => {
    let active = true;
    let updated = false;
    const remove = getCurrentWindow().listen<T>(event, ({ payload }) => {
      updated = true;
      if (active) setState(payload);
    });
    void remove
      .then(() => invoke<T>("agent_desktop_overlay_state"))
      .then((snapshot) => {
        if (active && !updated) setState(snapshot);
      })
      .catch(() => {});
    return () => {
      active = false;
      void remove.then((fn) => fn());
    };
  }, [event]);
  return state;
}

interface IslandState {
  status: string;
  meta: string;
  waiting: boolean;
}

function DesktopIsland() {
  const island = useOverlayState<IslandState>("misty://desktop-island", {
    status: "Misty is working with its own cursor",
    meta: "",
    waiting: false,
  });
  const [text, setText] = useState("");
  const press = (action: string, message = "") =>
    void invoke("agent_desktop_island_press", { action, text: message }).catch(() => {});
  const submit = (action: "send" | "queue") => (event?: FormEvent) => {
    event?.preventDefault();
    const message = text.trim();
    if (!message) return;
    setText("");
    press(action, message);
  };
  return (
    <div className="desktop-island" role="region" aria-label="Misty desktop control">
      <div className="desktop-island-row">
        <span className="desktop-island-status" aria-live="polite">
          {island.status}
        </span>
        {island.meta && <span className="desktop-island-meta">{island.meta}</span>}
      </div>
      {!island.waiting && (
        <form className="desktop-island-row" onSubmit={submit("send")}>
          <Input
            variant="bare"
            className="desktop-island-field"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Tell Misty what to change, or ask for something new"
            aria-label="Message for Misty"
          />
          <Button type="submit" variant="secondary" size="sm">
            Send
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => submit("queue")()}>
            New task
          </Button>
        </form>
      )}
      <div className="desktop-island-row">
        {!island.waiting && (
          <Button type="button" variant="secondary" size="sm" onClick={() => press("takeover")}>
            Take over
          </Button>
        )}
        <span className="desktop-island-hint">Esc stops</span>
        {island.waiting && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            autoFocus
            onClick={() => press("done")}
          >
            Done
          </Button>
        )}
        <Button type="button" variant="secondary" size="sm" onClick={() => press("stop")}>
          Stop
        </Button>
      </div>
    </div>
  );
}

interface Pointer {
  x: number;
  y: number;
}

function DesktopMist() {
  const mist = useOverlayState<{ waiting: boolean }>("misty://desktop-mist", { waiting: false });
  const [pointer, setPointer] = useState<(Pointer & { pulse: number }) | null>(null);
  useEffect(() => {
    const remove = getCurrentWindow().listen<Pointer | null>(
      "misty://desktop-pointer",
      ({ payload }) =>
        setPointer((previous) =>
          payload ? { ...payload, pulse: (previous?.pulse ?? 0) + 1 } : null,
        ),
    );
    return () => void remove.then((fn) => fn());
  }, []);
  return (
    <div
      className={mist.waiting ? "desktop-mist desktop-mist-waiting" : "desktop-mist"}
      aria-hidden
    >
      {pointer && (
        <svg
          className="desktop-pointer"
          style={{ left: pointer.x - 2, top: pointer.y - 2 }}
          width="26"
          height="30"
          viewBox="0 0 26 30"
        >
          <path d="M2 2 L22 17 L13 18 L9 26 Z" />
          <circle key={pointer.pulse} className="desktop-pointer-pulse" cx="2" cy="2" r="10" />
        </svg>
      )}
    </div>
  );
}

interface DockCard {
  id: string;
  name: string;
  status: string;
  waiting: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

function DockStack() {
  const [cards, setCards] = useState<DockCard[]>([]);
  useEffect(() => {
    const remove = getCurrentWindow().listen<{ cards: DockCard[] }>(
      "misty://dock-stack",
      ({ payload }) => setCards(payload.cards),
    );
    return () => void remove.then((fn) => fn());
  }, []);
  const press = (action: "open" | "stop", id: string) =>
    void invoke("agent_dock_card", { action, id }).catch(() => {});
  return (
    <div className="dock-stack">
      {cards.map((card) => (
        <div
          key={card.id}
          className="dock-card"
          style={{ left: card.x, top: card.y, width: card.width, height: card.height }}
        >
          <Button
            type="button"
            variant="ghost"
            className="dock-card-view"
            aria-label={`Open ${card.name || "agent"} window`}
            onClick={() => press("open", card.id)}
          />
          <div className="dock-card-caption">
            <span className="dock-card-text">
              <strong>{card.name || "Agent"}</strong>
              <span>{card.waiting ? "Waiting for you" : card.status || "Working"}</span>
            </span>
            <Button
              type="button"
              variant="secondary"
              size="xs"
              onClick={() => press("stop", card.id)}
            >
              Stop
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
