// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { useId, useState, type KeyboardEvent } from "react";
import { cn, Pressable, RailTick, Surface, Text } from "@/shared/ui";
import type { MessageAnchor } from "./timelineAnchors";

type VisibleMessageAnchor = {
  anchor: MessageAnchor;
  originalIndex: number;
  placement: "down" | "center" | "up";
};

/** Past this many messages the rail buckets them into a bounded number of dashes, keeping the
 * active one inside its bucket. */
const MAX_VISIBLE_ANCHOR_DASHES = 32;
/** Rows near either end flip their preview so it never clips outside the rail. */
const PREVIEW_EDGE_ROW_COUNT = 6;

function getVisibleAnchorDashes(
  anchors: MessageAnchor[],
  activeAnchorId: string | null,
): VisibleMessageAnchor[] {
  const activeIndex = activeAnchorId
    ? anchors.findIndex((anchor) => anchor.id === activeAnchorId)
    : -1;
  const indexes =
    anchors.length <= MAX_VISIBLE_ANCHOR_DASHES
      ? anchors.map((_, index) => index)
      : Array.from({ length: MAX_VISIBLE_ANCHOR_DASHES }, (_, bucket) => {
          const start = Math.floor((bucket * anchors.length) / MAX_VISIBLE_ANCHOR_DASHES);
          const end = Math.floor(((bucket + 1) * anchors.length) / MAX_VISIBLE_ANCHOR_DASHES);
          const bucketEnd = Math.max(start + 1, end);
          return activeIndex >= start && activeIndex < bucketEnd
            ? activeIndex
            : Math.floor((start + bucketEnd - 1) / 2);
        });
  return indexes.map((originalIndex, visibleIndex) => {
    const hasMiddleRows = indexes.length > PREVIEW_EDGE_ROW_COUNT * 2;
    return {
      anchor: anchors[originalIndex],
      originalIndex,
      placement:
        visibleIndex < PREVIEW_EDGE_ROW_COUNT
          ? "down"
          : hasMiddleRows && visibleIndex >= indexes.length - PREVIEW_EDGE_ROW_COUNT
            ? "up"
            : "center",
    };
  });
}

/** Dash widths by distance from the hovered one, so the rail reads as one stack. */
const PROXIMITY_WIDTHS = [32, 26, 22, 18];

/**
 * A rail of dashes beside the transcript, one per message the person sent: the active dash follows
 * the scroll, a click jumps to its message, and hovering or focusing one shows a short preview.
 * It never grows into a full outline of the chat.
 */
export function MessageAnchorRail({
  activeAnchorId,
  anchors,
  onScrollToAnchor,
}: {
  activeAnchorId: string | null;
  anchors: MessageAnchor[];
  onScrollToAnchor: (anchorId: string) => void;
}) {
  const previewId = useId();
  const [previewAnchorId, setPreviewAnchorId] = useState<string | null>(null);
  // One message needs no way to jump between messages.
  if (anchors.length < 2) return null;
  const visible = getVisibleAnchorDashes(anchors, activeAnchorId);
  const previewIndex = previewAnchorId
    ? visible.findIndex(({ anchor }) => anchor.id === previewAnchorId)
    : -1;
  const jump = (anchorId: string) => {
    setPreviewAnchorId(null);
    onScrollToAnchor(anchorId);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, anchorId: string) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    jump(anchorId);
  };
  return (
    <nav
      aria-label="Your messages"
      // Takes no layout space: it floats over the conversation's left edge, under the transcript's
      // padding, centered up and down between the chat's header and the composer.
      className={cn(
        "pointer-events-none absolute top-[calc(var(--agent-conversation-inset,0px)+3.5rem)] bottom-35 left-3",
        "z-[var(--stack-sticky)] flex w-10 flex-col items-start justify-center-safe gap-0.5 overflow-visible",
        "max-[900px]:hidden",
      )}
      onMouseLeave={() => setPreviewAnchorId(null)}
    >
      {visible.map(({ anchor, originalIndex, placement }, visibleIndex) => {
        const active = activeAnchorId === anchor.id;
        const previewing = previewAnchorId === anchor.id;
        const distance = previewIndex < 0 ? -1 : Math.abs(visibleIndex - previewIndex);
        const label = anchor.title.trim() || `Message ${originalIndex + 1}`;
        return (
          <div key={anchor.id} className="pointer-events-auto relative h-2 w-10 shrink-0">
            <Pressable
              className="relative block h-2 w-10 rounded-sm"
              onMouseEnter={() => setPreviewAnchorId(anchor.id)}
              onFocus={() => setPreviewAnchorId(anchor.id)}
              onBlur={() => setPreviewAnchorId(null)}
              onClick={() => jump(anchor.id)}
              onKeyDown={(event) => onKeyDown(event, anchor.id)}
              aria-current={active ? "location" : undefined}
              aria-describedby={previewing ? previewId : undefined}
              aria-label={label}
              data-anchor-target={anchor.id}
            >
              <RailTick
                state={active ? "current" : distance === 0 ? "near" : "rest"}
                length={distance >= 0 && distance <= 3 ? PROXIMITY_WIDTHS[distance] : 13}
                className="absolute inset-y-0 left-0 my-auto"
              />
            </Pressable>
            {previewing ? (
              <Surface
                id={previewId}
                role="tooltip"
                tone="card"
                edge="hairline"
                radius="lg"
                raised
                data-placement={placement}
                className={cn(
                  "pointer-events-none absolute left-10 z-[var(--stack-sticky)] grid gap-1.5 px-3 py-2.5",
                  "w-[clamp(--spacing(55),40vw,--spacing(95))]",
                  placement === "down" && "-top-0.5",
                  placement === "up" && "-bottom-0.5",
                  placement === "center" && "-inset-y-50 my-auto h-fit",
                )}
              >
                <Text as="strong" size="meta" weight="medium" tone="default" lines={2}>
                  {originalIndex + 1}. {label}
                </Text>
                {anchor.description ? (
                  <Text size="caption" tone="muted" lines={3} className="max-h-[3lh]">
                    {anchor.description}
                  </Text>
                ) : null}
              </Surface>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}
