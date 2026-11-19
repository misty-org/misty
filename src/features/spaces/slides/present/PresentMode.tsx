import { useEffect, useRef, useState } from "react";
import { Portal, Surface, Text, ViewportLayer } from "@/shared/ui";
import type { ItemVisibility } from "../../api/visibility";
import type { SlideSnapshot } from "../deck/snapshot";
import type { DeckTheme } from "../deck/themes";
import { useElementSize } from "../render/renderHooks";
import { SlideView } from "../render/SlideView";

export interface PresentModeProps {
  /** The slides shown, hidden ones already left out. */
  slides: SlideSnapshot[];
  /** Each shown slide's number in the whole deck. */
  numbers: number[];
  theme: DeckTheme;
  deckTitle: string;
  spaceId: string;
  deckId: string;
  hostVisibility: ItemVisibility;
  startIndex: number;
  /** Told the slide shown last, so the editor can open on it. */
  onClose(lastSlideId: string | null): void;
}

const nextKeys = new Set(["ArrowRight", "ArrowDown", " ", "PageDown", "Enter"]);
const previousKeys = new Set(["ArrowLeft", "ArrowUp", "PageUp", "Backspace"]);

/**
 * The deck presented: the whole window, made fullscreen, one slide at a time. Clickers work
 * (Space, PageDown, PageUp), B blacks the screen, N shows the notes over the slide, P switches to
 * the presenter layout (current slide, next slide, notes and timer), Esc leaves.
 */
export function PresentMode(props: PresentModeProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(() =>
    Math.min(Math.max(0, props.startIndex), Math.max(0, props.slides.length - 1)),
  );
  const [black, setBlack] = useState(false);
  const [notesShown, setNotesShown] = useState(false);
  const [presenter, setPresenter] = useState(false);
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const size = useElementSize(rootRef);
  const count = props.slides.length;
  const slide = props.slides[Math.min(index, count - 1)] ?? null;
  const next = props.slides[index + 1] ?? null;

  const close = useRef(props.onClose);
  close.current = props.onClose;
  const shownId = useRef<string | null>(slide?.id ?? null);
  shownId.current = slide?.id ?? null;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    let entered = false;
    const onChange = () => {
      if (document.fullscreenElement) entered = true;
      else if (entered) close.current(shownId.current);
    };
    document.addEventListener("fullscreenchange", onChange);
    void root?.requestFullscreen?.().catch(() => undefined);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key;
      if (key === "Escape") {
        event.preventDefault();
        close.current(shownId.current);
        return;
      }
      if (nextKeys.has(key)) {
        event.preventDefault();
        setBlack(false);
        setIndex((current) => Math.min(current + 1, count - 1));
      } else if (previousKeys.has(key)) {
        event.preventDefault();
        setBlack(false);
        setIndex((current) => Math.max(current - 1, 0));
      } else if (key === "Home") {
        event.preventDefault();
        setIndex(0);
      } else if (key === "End") {
        event.preventDefault();
        setIndex(Math.max(0, count - 1));
      } else if (key === "b" || key === "B" || key === ".") {
        event.preventDefault();
        setBlack((current) => !current);
      } else if (key === "n" || key === "N") {
        event.preventDefault();
        setNotesShown((current) => !current);
      } else if (key === "p" || key === "P") {
        event.preventDefault();
        setPresenter((current) => !current);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [count]);

  const panel = presenter ? 340 : 0;
  const room = {
    width: Math.max(0, size.width - panel - 48),
    height: Math.max(0, size.height - 48),
  };
  const slideWidth = Math.floor(Math.min(room.width, (room.height * 16) / 9));

  return (
    <Portal>
      <ViewportLayer
        ref={rootRef}
        layer="blocking-popup"
        role="dialog"
        aria-modal="true"
        aria-label={`Presenting ${props.deckTitle}`}
        className="grid"
        style={{
          // The room around a presented slide is black, as on a projector.
          background: "#000000",
          gridTemplateColumns: presenter ? "minmax(0, 1fr) 340px" : "minmax(0, 1fr)",
        }}
        onClick={(event) => {
          if (event.target instanceof HTMLElement && event.target.closest("[data-presenter-panel]"))
            return;
          setBlack(false);
          setIndex((current) => Math.min(current + 1, count - 1));
        }}
      >
        <div className="relative grid min-h-0 min-w-0 place-items-center p-6">
          {slide && !black && slideWidth > 0 ? (
            <SlideView
              slide={slide}
              theme={props.theme}
              deckTitle={props.deckTitle}
              number={props.numbers[index] ?? index + 1}
              spaceId={props.spaceId}
              deckId={props.deckId}
              hostVisibility={props.hostVisibility}
              embedMode="live"
              showEmpty={false}
              width={slideWidth}
              label={`Slide ${index + 1} of ${count}`}
            />
          ) : null}
          {notesShown && !presenter && slide?.notes ? (
            <Surface
              tone="smoke"
              radius="lg"
              data-presenter-panel=""
              className="absolute inset-x-6 bottom-6 max-h-[40%] overflow-auto p-4"
            >
              <Text size="page" wrap>
                {slide.notes}
              </Text>
            </Surface>
          ) : null}
        </div>
        {presenter ? (
          <Surface
            tone="card"
            data-presenter-panel=""
            className="flex min-h-0 flex-col gap-3.5 overflow-auto p-4"
          >
            <Text size="display" weight="semibold" tone="bright" className="tabular-nums">
              {elapsed(now - startedAt)}
            </Text>
            <Text size="caption" tone="muted" weight="medium">
              {`Slide ${index + 1} of ${count}`}
            </Text>
            <Text size="caption" tone="muted" weight="medium">
              Next
            </Text>
            {next ? (
              <Surface tone="none" edge="hairline" radius="sm" className="overflow-hidden">
                <SlideView
                  slide={next}
                  theme={props.theme}
                  deckTitle={props.deckTitle}
                  number={props.numbers[index + 1] ?? index + 2}
                  spaceId={props.spaceId}
                  deckId={props.deckId}
                  hostVisibility={props.hostVisibility}
                  embedMode="still"
                  showEmpty={false}
                />
              </Surface>
            ) : (
              <Text size="control" tone="muted">
                End of the deck
              </Text>
            )}
            <Text size="caption" tone="muted" weight="medium">
              Notes
            </Text>
            <Text size="body" wrap>
              {slide?.notes || "No notes for this slide."}
            </Text>
          </Surface>
        ) : null}
      </ViewportLayer>
    </Portal>
  );
}

function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours
    ? `${hours}:${pad(minutes % 60)}:${pad(seconds % 60)}`
    : `${pad(minutes)}:${pad(seconds % 60)}`;
}
