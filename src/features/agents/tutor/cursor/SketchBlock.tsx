import { useEffect, useMemo, useRef, useState } from "react";
import { Play } from "lucide-react";
import { openReading } from "@/features/voice";
import { Button, SetupState, sketchInk, spaceMadeKind, Surface, Text } from "@/shared/ui";
import {
  spacesSnapshot,
  useWorkspaceStore,
  windowSpace,
  workspaceSurfaceFromRoute,
} from "@/features/app-windows";
import { spacesGateway } from "../../spaces-gateway/spacesGateway";
import { withPictures } from "./companionPictures";
import { parseSketch, sketchSkeleton } from "./companionSketch";
import { createModelView, type ModelView } from "./modelView";
import { renderSketch } from "./sketchRender";

/**
 * A reply's drawing in the transcript (companionSketch.ts): the whiteboard itself, the
 * marks Misty drew over the screen without the screenshot under them, or a 3D model that
 * can be dragged around. Save as whiteboard makes a board or marks a Space whiteboard anyone in
 * the Space can keep editing.
 */
export function SketchBlock({ source }: { source: string }) {
  const sketch = useMemo(() => parseSketch("```misty-sketch\n" + source + "\n```"), [source]);
  const canvas = useRef<HTMLDivElement>(null);
  const [drawn, setDrawn] = useState(false);
  // The drawing or model couldn't be shown: the notice says so, and nothing is still setting up.
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const count = sketch?.elements.length ?? 0;
  const isModel = sketch?.header.surface === "model";
  // Bumped as each picture in the drawing arrives, to draw it again with the picture.
  const [pictures, setPictures] = useState(0);
  const model = useRef<Promise<ModelView | undefined> | undefined>(undefined);
  // While a replay runs, how many elements are back on the board; undefined shows them all.
  const [replay, setReplay] = useState<number | undefined>(undefined);
  // What was said as it was drawn, so the drawing still explains itself when read.
  const narration = sketch?.elements
    .map((e) => e.say)
    .filter(Boolean)
    .join(" ");
  // Redraw when a line completes, not on every token of the reply.
  const latest = useRef(sketch);
  latest.current = sketch;

  useEffect(() => {
    const drawing = latest.current;
    if (!drawing?.elements.length || drawing.header.surface !== "model" || !canvas.current) return;
    if (!model.current) {
      const stage = document.createElement("div");
      stage.className = "size-full";
      canvas.current.replaceChildren(stage);
      model.current = createModelView(stage, { draggable: true }).catch(() => undefined);
    }
    const parts = replay === undefined ? drawing.elements : drawing.elements.slice(0, replay);
    void model.current.then((view) => {
      if (!view) {
        setFailed(true);
        return setNotice("This model couldn't be shown.");
      }
      view.update(parts);
      setDrawn(true);
    });
  }, [count, replay]);

  // The model goes with the block.
  useEffect(
    () => () => {
      void model.current?.then((view) => view?.dispose());
      model.current = undefined;
    },
    [],
  );

  useEffect(() => {
    const drawing = latest.current;
    if (!drawing?.elements.length || drawing.header.surface === "model") return;
    const all = withPictures(drawing.elements, () => setPictures((n) => n + 1));
    const elements = replay === undefined ? all : all.slice(0, replay);
    if (!elements.length) {
      canvas.current?.replaceChildren();
      return;
    }
    let current = true;
    void renderSketch(elements, sketchInk.board)
      .then((result) => {
        if (!current || !result || !canvas.current) return;
        result.svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
        // The drawing itself (not a glyph) fills the board.
        result.svg.classList.add("size-full");
        canvas.current.replaceChildren(result.svg);
        setDrawn(true);
      })
      .catch(() => {
        if (!current) return;
        setFailed(true);
        setNotice("This drawing couldn't be shown.");
      });
    return () => {
      current = false;
    };
  }, [count, pictures, replay]);

  if (!sketch) return null;

  /** Draws it again from nothing while its narration is read, each part as its sentence begins. */
  const play = async () => {
    const elements = sketch.elements;
    const reading = openReading();
    // Which sentence brings in each element: a narrated one starts the next sentence.
    const sentenceOf: number[] = [];
    let said = -1;
    for (const element of elements) {
      if (element.say) {
        said++;
        reading.add(element.say);
      }
      sentenceOf.push(Math.max(said, 0));
    }
    setReplay(0);
    let readingDone = false;
    const ended = reading.end().finally(() => (readingDone = true));
    while (!readingDone) {
      const started = await reading.started();
      setReplay(sentenceOf.filter((sentence) => sentence < started).length);
      await new Promise((wait) => setTimeout(wait, 100));
    }
    await ended.catch(() => undefined);
    setReplay(undefined);
  };

  const save = async () => {
    const spaceId = windowSpace(spacesSnapshot().spaces)?.id;
    if (!spaceId) {
      setNotice("Open a Space in this window to save sketches there as whiteboards.");
      return;
    }
    setSaving(true);
    setNotice("");
    try {
      const { convertToExcalidrawElements } = await import("@excalidraw/excalidraw");
      const drawing = await spacesGateway
        .get()
        .createDrawing(
          spaceId,
          sketch.header.title || "Sketch from Misty",
          convertToExcalidrawElements(
            sketchSkeleton(sketch.elements) as Parameters<typeof convertToExcalidrawElements>[0],
          ),
        );
      const surface = workspaceSurfaceFromRoute(
        `/spaces/${encodeURIComponent(spaceId)}/drawings/${encodeURIComponent(drawing.id)}`,
      );
      if (surface) useWorkspaceStore.getState().openSurface({ ...surface, forceNew: true });
    } catch {
      setNotice("Misty couldn't save this sketch. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <figure className="my-3" aria-label={sketch.header.title || "Drawing"}>
      {sketch.header.title || sketch.header.surface === "screen" ? (
        <Text as="figcaption" size="caption" tone="muted" wrap className="mb-1.5">
          {sketch.header.surface === "screen" ? "Marked on your screen" : sketch.header.title}
        </Text>
      ) : null}
      <Surface
        tone="board"
        edge="hairline"
        radius="xl"
        className="relative grid h-70 place-items-center overflow-hidden p-3"
      >
        {/* The drawing is put in here by hand, so it shares no parent with what React draws. */}
        <div ref={canvas} className="grid size-full place-items-center" />
        {!drawn && !failed && (
          <div className="absolute inset-0">
            <SetupState tool="sketch" label="Drawing the sketch" />
          </div>
        )}
      </Surface>
      {narration ? (
        <Text as="p" size="body" wrap className="mt-2">
          {narration}
        </Text>
      ) : null}
      {(!isModel || notice || narration) && (
        <div className="mt-2 flex items-center gap-2.5">
          {narration ? (
            <Button
              icon={Play}
              disabled={!sketch.done || replay !== undefined}
              onClick={() => void play()}
            >
              Replay
            </Button>
          ) : null}
          {!isModel && (
            <Button
              icon={spaceMadeKind("drawing").icon}
              disabled={!sketch.done || !count || saving}
              onClick={() => void save()}
            >
              Save as whiteboard
            </Button>
          )}
          {notice && (
            <Text role="status" size="caption" tone="muted" wrap>
              {notice}
            </Text>
          )}
        </div>
      )}
    </figure>
  );
}
