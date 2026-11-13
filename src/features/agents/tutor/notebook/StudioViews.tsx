import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Maximize2, Minus, Plus, Trash2 } from "lucide-react";
import { confirmAction } from "@/shared/lib/confirmAction";
import { Button, IconButton, Pressable, Separator, Surface, Text } from "@/shared/ui";
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
    <div className="flex min-h-9 items-center justify-between gap-2">
      <IconButton label="Back to Create" onClick={onClose}>
        <ArrowLeft />
      </IconButton>
      <Text size="control" tone="bright">
        {guide.title}
      </Text>
      <span className="ml-auto flex items-center gap-0.5">
        <IconButton label="Delete" onClick={() => void remove(guide, onClose)}>
          <Trash2 />
        </IconButton>
      </span>
    </div>
  );
}

/** A list of branches, each a step to the right of the node it grows from. */
const childrenClass = "relative m-0 flex list-none flex-col gap-1.5 p-0";

/** A node's words and its fold button, on one line. */
const nodeClass = "inline-flex flex-none items-center gap-1.5 py-1 pr-2 pl-3 whitespace-nowrap";

function Branch({ node, depth }: { node: MindNode; depth: number }) {
  const [open, setOpen] = useState(depth < 2);
  const children = node.children ?? [];
  const label = <span>{node.label}</span>;
  const toggle = children.length ? (
    <Surface
      as={Pressable}
      tone="none"
      edge="strong"
      radius="md"
      className="inline-flex size-4.5 items-center justify-center"
      aria-label={open ? `Fold ${node.label}` : `Unfold ${node.label}`}
      aria-expanded={open}
      onClick={() => setOpen(!open)}
    >
      <Text bare tone="muted" className="inline-flex">
        {open ? <Minus /> : <Plus />}
      </Text>
    </Surface>
  ) : null;
  return (
    <li className="relative flex items-center" data-depth={Math.min(depth, 3)}>
      {/* The stroke from the line down the left to this branch's node. */}
      {depth > 0 ? <Separator strong className="absolute top-1/2 -left-3.5 w-3" /> : null}
      {/* The central idea and its branches take the map's color; the twigs past them are plain. */}
      {depth < 2 ? (
        <Surface
          as="span"
          tint="map"
          tintLevel={depth === 0 ? "strong" : "faint"}
          radius="lg"
          className={nodeClass}
        >
          <Text bare size="caption" tone="bright" weight={depth === 0 ? "semibold" : undefined}>
            {label}
          </Text>
          {toggle}
        </Surface>
      ) : (
        <Surface as="span" tone="page" edge="hairline" radius="lg" className={nodeClass}>
          <Text bare size="caption" tone="default">
            {label}
          </Text>
          {toggle}
        </Surface>
      )}
      {open && children.length ? (
        <ul className={`${childrenClass} pl-6`}>
          {/* The line down the left that the branches grow from. */}
          <Separator
            asChild
            orientation="vertical"
            strong
            className="absolute inset-y-3.5 left-2.5 h-auto"
          >
            <li />
          </Separator>
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
      <div className="overflow-auto px-1 pt-2 pb-4">
        {map.map ? (
          <ul className={childrenClass}>
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
      <div className="flex items-center gap-1.5">
        <IconButton label="Previous slide" disabled={at === 0} onClick={() => move(-1)}>
          <ChevronLeft />
        </IconButton>
        <Text bare size="caption" tone="muted" className="flex-none">
          {at + 1} / {slides.length}
        </Text>
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
      {notes ? (
        <Text wrap size="caption" tone="muted" className="leading-[1.6] whitespace-pre-wrap">
          {notes}
        </Text>
      ) : null}
    </>
  );
}
