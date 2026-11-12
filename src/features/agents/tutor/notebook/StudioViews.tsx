import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Maximize2, Minus, Plus, Trash2 } from "lucide-react";
import { confirmAction } from "@/shared/lib/confirmAction";
import { Button, IconButton, Pressable, OverflowFadeText } from "@/shared/ui";
import { MistyMarkdown } from "../../runs/markdown/MistyMarkdown";
import { slidesOf } from "../tutorStudio";
import { useTutorStore } from "../tutorStore";
import type { Guide, MindNode } from "../tutorTypes";

async function remove(guide: Guide, onClose: () => void) {
  if (!(await confirmAction(`Delete “${guide.title}”? This can’t be undone.`))) return;
  useTutorStore.getState().removeGuide(guide.id);
  onClose();
}

function Head({ guide, onClose }: { guide: Guide; onClose(): void }) {
  return (
    <div className="tutor-lead">
      <IconButton label="Back to Create" onClick={onClose}>
        <ArrowLeft />
      </IconButton>
      <OverflowFadeText className="tutor-card-title">{guide.title}</OverflowFadeText>
      <span className="tutor-actions">
        <IconButton label="Delete" onClick={() => void remove(guide, onClose)}>
          <Trash2 />
        </IconButton>
      </span>
    </div>
  );
}

function Branch({ node, depth }: { node: MindNode; depth: number }) {
  const [open, setOpen] = useState(depth < 2);
  const children = node.children ?? [];
  return (
    <li className="tutor-map-branch" data-depth={Math.min(depth, 3)}>
      <span className="tutor-map-node">
        <span>{node.label}</span>
        {children.length ? (
          <Pressable
            className="tutor-map-toggle"
            aria-label={open ? `Fold ${node.label}` : `Unfold ${node.label}`}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? <Minus size={11} /> : <Plus size={11} />}
          </Pressable>
        ) : null}
      </span>
      {open && children.length ? (
        <ul className="tutor-map-children">
          {children.map((child, index) => (
            <Branch key={`${child.label}-${index}`} node={child} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** A mind map: the central idea at the left, its branches to the right, each one foldable. */
export function MindMapView({ map, onClose }: { map: Guide; onClose(): void }) {
  return (
    <>
      <Head guide={map} onClose={onClose} />
      <div className="tutor-map">
        {map.map ? (
          <ul className="tutor-map-children tutor-map-root">
            <Branch node={map.map} depth={0} />
          </ul>
        ) : null}
      </div>
    </>
  );
}

/** One slide's content and what a presenter would say, split at its "Notes:" line. */
function slideParts(slide: string): { content: string; notes: string } {
  const at = slide.search(/^\s*Notes:/m);
  return at < 0
    ? { content: slide, notes: "" }
    : { content: slide.slice(0, at).trim(), notes: slide.slice(at).replace(/^\s*Notes:\s*/, "") };
}

/** A slide deck, one slide at a time, with its notes; arrow keys move, and it can fill the screen. */
export function SlidesView({ deck, onClose }: { deck: Guide; onClose(): void }) {
  const slides = slidesOf(deck.body);
  const [at, setAt] = useState(0);
  const stage = useRef<HTMLDivElement>(null);
  const move = (step: number) =>
    setAt((current) => Math.min(slides.length - 1, Math.max(0, current + step)));
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement | null)?.closest("input, textarea, [contenteditable]"))
        return;
      if (event.key === "ArrowRight" || event.key === "PageDown") move(1);
      if (event.key === "ArrowLeft" || event.key === "PageUp") move(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const { content, notes } = slideParts(slides[at] ?? "");
  return (
    <>
      <Head guide={deck} onClose={onClose} />
      <div ref={stage} className="tutor-slide-stage">
        <div className="tutor-slide">
          <MistyMarkdown>{content}</MistyMarkdown>
        </div>
      </div>
      <div className="tutor-slide-controls">
        <IconButton label="Previous slide" disabled={at === 0} onClick={() => move(-1)}>
          <ChevronLeft />
        </IconButton>
        <span className="tutor-card-detail">
          {at + 1} / {slides.length}
        </span>
        <IconButton label="Next slide" disabled={at >= slides.length - 1} onClick={() => move(1)}>
          <ChevronRight />
        </IconButton>
        <Button
          variant="quiet"
          className="ml-auto"
          onClick={() => void stage.current?.requestFullscreen?.().catch(() => undefined)}
          icon={Maximize2}
        >
          Present
        </Button>
      </div>
      {notes ? <p className="tutor-slide-notes">{notes}</p> : null}
    </>
  );
}
