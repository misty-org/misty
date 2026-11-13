import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState, type FormEvent } from "react";
import { Button, cn, Input, screenMarkClass, Surface, ViewportLayer } from "@/shared/ui";
import { DictationPill } from "@/features/voice";
// These windows draw with the app's own classes; the mist's page stays transparent
// (desktop.html), so nothing opaque ever covers the screen.
import "@/styles/styles.css";

/**
 * Misty's windows while it controls the desktop or its own window on Windows
 * (src-tauri/features/agents/desktop_control/windows/overlays.rs): the control island, and
 * the mist that rings what Misty controls and carries its own pointer. The window's label says
 * which this page is.
 */
export function DesktopOverlayRoot() {
  const label = getCurrentWebview().label;
  if (label === "misty-desktop-island") return <DesktopIsland />;
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
    <Surface
      tone="smoke"
      radius="2xl"
      className="flex size-full flex-col gap-2 px-3 pt-3 pb-2.5 text-meta font-medium"
      role="region"
      aria-label="Misty desktop control"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span
          className="flex-1 overflow-hidden whitespace-nowrap [mask-image:var(--mask-fade-end)]"
          aria-live="polite"
        >
          {island.status}
        </span>
        {island.meta && <span className="whitespace-nowrap opacity-60">{island.meta}</span>}
      </div>
      {!island.waiting && (
        <form className="flex min-w-0 items-center gap-2" onSubmit={submit("send")}>
          <Input
            variant="smoke"
            className="flex-1"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Tell Misty what to change, or ask for something new"
            aria-label="Message for Misty"
          />
          <Button type="submit" variant="secondary">
            Send
          </Button>
          <Button type="button" variant="secondary" onClick={() => submit("queue")()}>
            New task
          </Button>
        </form>
      )}
      <div className="flex min-w-0 items-center gap-2">
        {!island.waiting && (
          <Button type="button" variant="secondary" onClick={() => press("takeover")}>
            Take over
          </Button>
        )}
        <span className="ml-auto whitespace-nowrap opacity-60">Esc stops</span>
        {island.waiting && (
          <Button type="button" variant="secondary" autoFocus onClick={() => press("done")}>
            Done
          </Button>
        )}
        <Button type="button" variant="secondary" onClick={() => press("stop")}>
          Stop
        </Button>
      </div>
    </Surface>
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
    <ViewportLayer
      layer="agent-surface"
      passthrough
      className={cn(
        "transition-shadow duration-400 ease-[ease] motion-reduce:transition-none",
        mist.waiting ? screenMarkClass.edgeGlowQuiet : screenMarkClass.edgeGlow,
      )}
      aria-hidden
    >
      {pointer && (
        <svg
          className="desktop-pointer absolute overflow-visible transition-[left,top] duration-250 ease-[ease] motion-reduce:transition-none"
          style={{ left: pointer.x - 2, top: pointer.y - 2 }}
          width="26"
          height="30"
          viewBox="0 0 26 30"
        >
          <path className={screenMarkClass.pointer} d="M2 2 L22 17 L13 18 L9 26 Z" />
          <circle key={pointer.pulse} className={screenMarkClass.ripple} cx="2" cy="2" r="10" />
        </svg>
      )}
    </ViewportLayer>
  );
}
