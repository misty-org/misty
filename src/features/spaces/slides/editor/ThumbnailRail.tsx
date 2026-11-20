import { Copy, Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import { memo, useCallback, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import {
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
  IndicatorDot,
  MenuItem,
  MenuSeparator,
  Pressable,
  ScrollArea,
  Surface,
  Text,
  cn,
} from "@misty/ui";
import type { ItemVisibility } from "../../api/visibility";
import type { SlideSnapshot } from "../deck/snapshot";
import type { DeckTheme } from "../deck/themes";
import type { TextSlotName } from "../deck/types";
import type { DeckPeer } from "../hooks/useDeckPresence";
import { SlideView } from "../render/SlideView";
import { PresenceAvatars } from "./PresenceAvatars";

const slideDragType = "application/x-misty-slide";

export interface ThumbnailRailProps {
  slides: SlideSnapshot[];
  theme: DeckTheme;
  deckTitle: string;
  spaceId: string;
  deckId: string;
  hostVisibility: ItemVisibility;
  currentId: string | null;
  peers: DeckPeer[];
  canEdit: boolean;
  overflowing: Record<string, boolean>;
  onSelect(id: string): void;
  /** Puts a slide after `after`, or first when it is null. */
  onMove(id: string, after: string | null): void;
  onNewAfter(id: string): void;
  onDuplicate(id: string): void;
  onToggleHidden(id: string): void;
  onDelete(id: string): void;
  onAdd(): void;
  onOverflow(id: string, slots: TextSlotName[]): void;
}

/** The numbered thumbnails down the left, like Preview's sidebar. */
export function ThumbnailRail(props: ThumbnailRailProps) {
  const [drop, setDrop] = useState<{ index: number } | null>(null);
  const dragging = useRef<string | null>(null);
  const ids = props.slides.map((slide) => slide.id);

  const dropAt = (index: number) => {
    const id = dragging.current;
    dragging.current = null;
    setDrop(null);
    if (!id) return;
    const before = ids.slice(0, index).filter((other) => other !== id);
    props.onMove(id, before.length ? before[before.length - 1] : null);
  };

  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const id = ids[index];
    if ((event.key === "Backspace" || event.key === "Delete") && props.canEdit) {
      event.preventDefault();
      props.onDelete(id);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      const next = ids[index + (event.key === "ArrowDown" ? 1 : -1)];
      if (!next) return;
      props.onSelect(next);
      const target = event.currentTarget.parentElement?.parentElement?.querySelector<HTMLElement>(
        `[data-slide-thumb="${next}"]`,
      );
      target?.focus();
    }
  };

  return (
    <div data-tour="deck-rail" className="contents">
      <ScrollArea className="h-full w-46 shrink-0" aria-label="Slides">
        <div
          className="flex flex-col gap-2.5 px-3 pt-3 pb-6"
          onDragOver={(event) => {
            if (dragging.current) event.preventDefault();
          }}
          onDrop={(event) => {
            event.preventDefault();
            if (drop) dropAt(drop.index);
          }}
        >
          {props.slides.map((slide, index) => (
            <div key={slide.id} className="relative">
              {drop?.index === index ? <DropLine edge="top" /> : null}
              <RailThumb
                slide={slide}
                index={index}
                theme={props.theme}
                deckTitle={props.deckTitle}
                spaceId={props.spaceId}
                deckId={props.deckId}
                hostVisibility={props.hostVisibility}
                selected={slide.id === props.currentId}
                overflow={Boolean(props.overflowing[slide.id])}
                peers={props.peers.filter((peer) => peer.slideId === slide.id)}
                canEdit={props.canEdit}
                onSelect={props.onSelect}
                onNewAfter={props.onNewAfter}
                onDuplicate={props.onDuplicate}
                onToggleHidden={props.onToggleHidden}
                onDelete={props.onDelete}
                onOverflow={props.onOverflow}
                onKeyDown={onKeyDown}
                onDragStart={(event) => {
                  dragging.current = slide.id;
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData(slideDragType, slide.id);
                }}
                onDragOver={(event) => {
                  if (!dragging.current) return;
                  event.preventDefault();
                  const rect = event.currentTarget.getBoundingClientRect();
                  const lower = event.clientY > rect.top + rect.height / 2;
                  const next = index + (lower ? 1 : 0);
                  setDrop((current) => (current?.index === next ? current : { index: next }));
                }}
                onDragEnd={() => {
                  dragging.current = null;
                  setDrop(null);
                }}
              />
              {drop?.index === index + 1 && index === props.slides.length - 1 ? (
                <DropLine edge="bottom" />
              ) : null}
            </div>
          ))}
          {props.canEdit ? (
            <div className="flex justify-center pl-5">
              <Button variant="quiet" icon={Plus} onClick={props.onAdd}>
                Slide
              </Button>
            </div>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
}

function DropLine({ edge }: { edge: "top" | "bottom" }) {
  return (
    <Surface
      tone="inverse"
      radius="full"
      className={cn(
        "pointer-events-none absolute right-0 left-5 h-0.5",
        edge === "top" ? "-top-1.5" : "-bottom-1.5",
      )}
    />
  );
}

const RailThumb = memo(function RailThumb(props: {
  slide: SlideSnapshot;
  index: number;
  theme: DeckTheme;
  deckTitle: string;
  spaceId: string;
  deckId: string;
  hostVisibility: ItemVisibility;
  selected: boolean;
  overflow: boolean;
  peers: DeckPeer[];
  canEdit: boolean;
  onSelect(id: string): void;
  onNewAfter(id: string): void;
  onDuplicate(id: string): void;
  onToggleHidden(id: string): void;
  onDelete(id: string): void;
  onOverflow(id: string, slots: TextSlotName[]): void;
  onKeyDown(event: KeyboardEvent, index: number): void;
  onDragStart(event: DragEvent<HTMLElement>): void;
  onDragOver(event: DragEvent<HTMLElement>): void;
  onDragEnd(): void;
}) {
  const { slide, onOverflow } = props;
  const number = props.index + 1;
  const reportOverflow = useCallback(
    (slots: TextSlotName[]) => onOverflow(slide.id, slots),
    [onOverflow, slide.id],
  );
  const thumb = (
    <div className="grid grid-cols-[1rem_minmax(0,1fr)] items-start gap-1.5">
      <Text
        size="caption"
        tone={props.selected ? "bright" : "muted"}
        className="relative pt-0.5 text-right tabular-nums"
      >
        {number}
      </Text>
      <Pressable
        data-slide-thumb={slide.id}
        aria-label={`Slide ${number}${slide.hidden ? ", hidden" : ""}`}
        aria-current={props.selected || undefined}
        draggable={props.canEdit}
        onClick={() => props.onSelect(slide.id)}
        onKeyDown={(event) => props.onKeyDown(event, props.index)}
        onDragStart={props.onDragStart}
        onDragOver={props.onDragOver}
        onDragEnd={props.onDragEnd}
        className="relative block w-full"
      >
        <Surface
          tone="none"
          edge={props.selected ? "bright" : "hairline"}
          radius="sm"
          className={cn("overflow-hidden", slide.hidden && "opacity-50")}
        >
          <SlideView
            slide={slide}
            theme={props.theme}
            deckTitle={props.deckTitle}
            number={number}
            spaceId={props.spaceId}
            deckId={props.deckId}
            hostVisibility={props.hostVisibility}
            embedMode="still"
            onOverflow={reportOverflow}
          />
        </Surface>
        {props.overflow ? <IndicatorDot /> : null}
        {slide.hidden ? (
          <Text bare tone="muted" className="absolute right-1 bottom-1">
            <EyeOff aria-hidden="true" />
          </Text>
        ) : null}
        {props.peers.length ? (
          <span className="absolute -top-1.5 -right-1.5">
            <PresenceAvatars peers={props.peers} max={2} size="xs" />
          </span>
        ) : null}
      </Pressable>
    </div>
  );
  if (!props.canEdit) return thumb;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{thumb}</ContextMenuTrigger>
      <ContextMenuContent width="md">
        <MenuItem icon={Plus} label="New slide after" onSelect={() => props.onNewAfter(slide.id)} />
        <MenuItem
          icon={Copy}
          label="Duplicate"
          shortcut="⌘D"
          onSelect={() => props.onDuplicate(slide.id)}
        />
        <MenuItem
          icon={slide.hidden ? Eye : EyeOff}
          label={slide.hidden ? "Show" : "Hide"}
          onSelect={() => props.onToggleHidden(slide.id)}
        />
        <MenuSeparator />
        <MenuItem
          icon={Trash2}
          label="Delete"
          shortcut="⌫"
          danger
          onSelect={() => props.onDelete(slide.id)}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
});
