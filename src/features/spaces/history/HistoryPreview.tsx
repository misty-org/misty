import { ErrorState, Skeleton, SkeletonDocument, Surface, Text } from "@misty/ui";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { BinaryFiles } from "@excalidraw/excalidraw/types";
import { useEffect, useState } from "react";
import { readDrawingElements } from "../journal/drawings/collaboration/drawingSceneStore";
import { hydrateDrawingBinaryFile } from "../journal/drawings/drawingAssets";
import type { DrawingAssetReference } from "../journal/drawings/drawingTypes";
import type { HistoryKind } from "./historyApi";
import {
  summarizeDeckVersion,
  summarizeNoteVersion,
  summarizeWorkbookVersion,
  versionDoc,
} from "./historySummary";

export interface HistoryPreviewProps {
  spaceId: string;
  kind: HistoryKind;
  itemId: string;
  /** The version's full Yjs state. */
  update: Uint8Array;
}

/** A doc version's text, block by block. */
function NoteVersionPreview(props: { update: Uint8Array }) {
  const doc = versionDoc(props.update);
  const summary = summarizeNoteVersion(doc);
  doc.destroy();
  const lines = summary.text.split("\n");
  return (
    <div className="grid gap-2">
      {summary.title ? (
        <Text size="page" tone="bright" weight="semibold" wrap>
          {summary.title}
        </Text>
      ) : null}
      {summary.text ? (
        lines.map((line, index) => (
          <Text key={index} size="body" tone="default" wrap>
            {line || " "}
          </Text>
        ))
      ) : (
        <Text size="body" tone="muted">
          This version is empty
        </Text>
      )}
    </div>
  );
}

/** A deck version's slides, by title. */
function DeckVersionPreview(props: { update: Uint8Array }) {
  const doc = versionDoc(props.update);
  const summary = summarizeDeckVersion(doc);
  doc.destroy();
  if (!summary.slides.length)
    return (
      <Text size="body" tone="muted">
        This version has no slides
      </Text>
    );
  return (
    <ol className="grid gap-1">
      {summary.slides.map((title, index) => (
        <li key={index} className="flex min-w-0 gap-3">
          <Text size="body" tone="muted" className="shrink-0 tabular-nums">
            {index + 1}
          </Text>
          <Text size="body" tone={title ? "default" : "muted"} className="min-w-0 flex-1">
            {title || "Untitled slide"}
          </Text>
        </li>
      ))}
    </ol>
  );
}

/** A workbook version's sheets and its chart count. */
function WorkbookVersionPreview(props: { update: Uint8Array }) {
  const doc = versionDoc(props.update);
  const summary = summarizeWorkbookVersion(doc);
  doc.destroy();
  return (
    <div className="grid gap-3">
      <ul className="grid gap-1">
        {summary.sheets.map((name, index) => (
          <li key={index}>
            <Text size="body" tone="default">
              {name}
            </Text>
          </li>
        ))}
      </ul>
      <Text size="meta" tone="muted">
        {summary.charts === 1 ? "1 chart" : `${summary.charts} charts`}
      </Text>
    </div>
  );
}

/** A whiteboard version drawn as an SVG, the way the board's own preview draws it. */
function DrawingVersionPreview(props: { spaceId: string; itemId: string; update: Uint8Array }) {
  const [view, setView] = useState<
    | { state: "drawing" }
    | { state: "empty" }
    | { state: "failed" }
    | { state: "ready"; url: string }
  >({ state: "drawing" });
  const { spaceId, itemId, update } = props;
  useEffect(() => {
    let active = true;
    let url = "";
    setView({ state: "drawing" });
    const doc = versionDoc(update);
    const render = async () => {
      const { exportToSvg, getNonDeletedElements } = await import("@excalidraw/excalidraw");
      const elements = getNonDeletedElements(
        readDrawingElements(doc.getMap<OrderedExcalidrawElement>("drawing:elements")),
      );
      if (!elements.length) return null;
      const references = [...doc.getMap<DrawingAssetReference>("drawing:files").values()];
      const hydrated = await Promise.allSettled(
        references.map(async (reference) => {
          const file = await hydrateDrawingBinaryFile(spaceId, itemId, reference);
          return [file.id, file] as const;
        }),
      );
      const files = Object.fromEntries(
        hydrated.flatMap((result) => (result.status === "fulfilled" ? [result.value] : [])),
      ) as BinaryFiles;
      const background = doc.getMap<unknown>("drawing:scene").get("viewBackgroundColor");
      const svg = await exportToSvg({
        elements,
        files,
        exportPadding: 24,
        appState: {
          exportBackground: false,
          viewBackgroundColor: typeof background === "string" ? background : "#ffffff",
        },
      });
      return URL.createObjectURL(
        new Blob([svg.outerHTML], { type: "image/svg+xml;charset=utf-8" }),
      );
    };
    render()
      .then((next) => {
        if (!active) {
          if (next) URL.revokeObjectURL(next);
          return;
        }
        if (!next) return setView({ state: "empty" });
        url = next;
        setView({ state: "ready", url: next });
      })
      .catch(() => {
        if (active) setView({ state: "failed" });
      })
      .finally(() => doc.destroy());
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [spaceId, itemId, update]);
  if (view.state === "drawing") return <Skeleton className="h-full min-h-48 w-full rounded-md" />;
  if (view.state === "empty")
    return (
      <Text size="body" tone="muted">
        This version is empty
      </Text>
    );
  if (view.state === "failed") return <ErrorState inline title="This version couldn’t be drawn" />;
  return (
    <Surface tone="board" radius="md" className="grid place-items-center overflow-hidden p-2">
      <img
        className="max-h-full max-w-full object-contain"
        src={view.url}
        alt="Whiteboard version"
      />
    </Surface>
  );
}

/** A version, read-only, in its kind's own way. */
export function HistoryPreview(props: HistoryPreviewProps) {
  if (props.kind === "notes") return <NoteVersionPreview update={props.update} />;
  if (props.kind === "decks") return <DeckVersionPreview update={props.update} />;
  if (props.kind === "workbooks") return <WorkbookVersionPreview update={props.update} />;
  return (
    <DrawingVersionPreview spaceId={props.spaceId} itemId={props.itemId} update={props.update} />
  );
}

/** The preview while a version is fetched, shaped like the kind's content. */
export function HistoryPreviewSkeleton(props: { kind: HistoryKind }) {
  if (props.kind === "drawings") return <Skeleton className="h-full min-h-48 w-full rounded-md" />;
  return <SkeletonDocument label="Loading version" />;
}
