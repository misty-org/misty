import { useAuth } from "@/features/account";
import {
  ErrorState,
  lazyTool,
  Skeleton,
  spaceMadeKind,
  Surface,
  Text,
  ToolSuspense,
} from "@misty/ui";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ItemVisibility } from "../api/visibility";
import { readEmbedSource, type EmbedSourceState } from "./embedSources";
import { embedSourceKind, type EmbedReference } from "./embedTypes";
import { embedShowsPrivate } from "./embedVisibility";

const DataChartEmbed = lazyTool(() =>
  import("@/features/spaces/data").then((module) => ({ default: module.DataChartEmbed })),
);
const DataRangeEmbed = lazyTool(() =>
  import("@/features/spaces/data").then((module) => ({ default: module.DataRangeEmbed })),
);
const BoardFrameEmbed = lazyTool(() =>
  import("./BoardFrameEmbed").then((module) => ({ default: module.BoardFrameEmbed })),
);

const realtimeEvents = {
  drawing: "misty:space-drawing-event",
  workbook: "misty:space-workbook-event",
} as const;

export interface LiveEmbedProps {
  spaceId: string;
  embed: EmbedReference;
  /** The doc's or deck's own layer: a private source shows "Private" in a shared host. */
  hostVisibility: ItemVisibility;
  /** Who made the host; a private host is its viewer's own, the default. */
  hostCreatorId?: string;
  /** Told the source's current title, so the host can keep it as the last-known one. */
  onSourceTitle?: (title: string) => void;
}

type SourceRead =
  { phase: "loading" } | { phase: "failed" } | { phase: "ready"; source: EmbedSourceState };

/** Reads an embed's source and reads it again when the Space says the source changed. */
function useEmbedSource(spaceId: string, embed: EmbedReference) {
  const kind = embedSourceKind(embed.kind);
  const itemId = embed.item_id;
  const [read, setRead] = useState<SourceRead>({ phase: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    let generation = 0;
    const load = () => {
      const current = ++generation;
      readEmbedSource(spaceId, kind, itemId)
        .then((source) => {
          if (active && current === generation) setRead({ phase: "ready", source });
        })
        .catch(() => {
          if (active && current === generation) setRead({ phase: "failed" });
        });
    };
    setRead({ phase: "loading" });
    load();
    const onEvent = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      let mentions = false;
      try {
        mentions = JSON.stringify(detail ?? null).includes(itemId);
      } catch {
        mentions = false;
      }
      if (mentions) load();
    };
    window.addEventListener(realtimeEvents[kind], onEvent);
    return () => {
      active = false;
      window.removeEventListener(realtimeEvents[kind], onEvent);
    };
  }, [spaceId, kind, itemId, attempt]);
  return { read, retry: () => setAttempt((value) => value + 1) };
}

/**
 * One live embed: a Data chart, a Data range as a table, or one Whiteboard frame, drawn from the
 * source each time it shows. When the source is gone or may no longer be shown here, the card
 * keeps the last-known title and says "Removed" or "Private".
 */
export function LiveEmbed(props: LiveEmbedProps) {
  const { user } = useAuth();
  const { read, retry } = useEmbedSource(props.spaceId, props.embed);
  const sourceKind = embedSourceKind(props.embed.kind);
  const Icon = spaceMadeKind(sourceKind).icon;
  const onSourceTitle = useRef(props.onSourceTitle);
  onSourceTitle.current = props.onSourceTitle;
  const liveTitle =
    read.phase === "ready" && read.source.state === "available" ? read.source.item.title : null;
  useEffect(() => {
    if (liveTitle) onSourceTitle.current?.(liveTitle);
  }, [liveTitle]);

  const fallbackTitle = props.embed.title || spaceMadeKind(sourceKind).untitled;
  let state: "Private" | "Removed" | null = null;
  let body: ReactNode = null;
  if (read.phase === "loading") {
    body = <Skeleton className="h-40 w-full rounded-md" />;
  } else if (read.phase === "failed") {
    body = (
      <ErrorState
        inline
        title="This embed couldn’t load"
        action={{ label: "Try again", variant: "secondary", onClick: retry }}
      />
    );
  } else if (read.source.state === "removed") {
    state = "Removed";
  } else if (
    read.source.state === "private" ||
    embedShowsPrivate(
      { visibility: props.hostVisibility, creatorId: props.hostCreatorId },
      read.source.item,
      user?.id,
    )
  ) {
    state = "Private";
  } else {
    body = (
      <ToolSuspense tool={props.embed.kind === "board-frame" ? "whiteboard frame" : "chart"}>
        {props.embed.kind === "data-chart" ? (
          <DataChartEmbed
            spaceId={props.spaceId}
            itemId={props.embed.item_id}
            partId={props.embed.part_id}
          />
        ) : props.embed.kind === "data-range" ? (
          <DataRangeEmbed
            spaceId={props.spaceId}
            itemId={props.embed.item_id}
            partId={props.embed.part_id}
          />
        ) : (
          <BoardFrameEmbed
            spaceId={props.spaceId}
            itemId={props.embed.item_id}
            partId={props.embed.part_id}
          />
        )}
      </ToolSuspense>
    );
  }

  return (
    <Surface
      tone="card"
      edge="hairline"
      radius="lg"
      className="grid min-w-0 gap-2 p-3"
      data-embed-kind={props.embed.kind}
      data-embed-state={state?.toLowerCase() ?? read.phase}
    >
      <div className="flex min-w-0 items-center gap-2">
        <Text bare tone="muted" className="flex shrink-0 items-center">
          <Icon aria-hidden="true" />
        </Text>
        <Text size="control" tone="default" weight="medium" className="min-w-0 flex-1">
          {liveTitle ?? fallbackTitle}
        </Text>
        {state ? (
          <Text size="meta" tone="muted" className="shrink-0">
            {state}
          </Text>
        ) : null}
      </div>
      {body}
    </Surface>
  );
}
