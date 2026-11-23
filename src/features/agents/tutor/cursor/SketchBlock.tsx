import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Shapes } from "lucide-react";
import { openReading } from "@/features/voice";
import { Button, notify, SetupState, sketchInk, Surface, Text } from "@misty/ui";
import { spacesSnapshot, windowSpace } from "@/features/app-windows";
import { spacesGateway } from "../../spaces-gateway/spaces_gateway";
import { withPictures } from "./companion_pictures";
import { parseSketch, sketchSkeleton } from "./companion_sketch";
import { createModelView, type ModelView } from "./model_view";
import { renderSketch } from "./sketch_render";

export function SketchBlock({ source }: { source: string }) {
  const sketch = useMemo(() => parseSketch("```misty-sketch\n" + source + "\n```"), [source]);
  const canvas = useRef<HTMLDivElement>(null);
  const [drawn, setDrawn] = useState(false);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const count = sketch?.elements.length ?? 0;
  const isModel = sketch?.header.surface === "model";
  const [pictures, setPictures] = useState(0);
  const model = useRef<Promise<ModelView | undefined> | undefined>(undefined);
  const [replay, setReplay] = useState<number | undefined>(undefined);
  const narration = sketch?.elements
    .map((e) => e.say)
    .filter(Boolean)
    .join(" ");
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

  const play = async () => {
    const elements = sketch.elements;
    const reading = openReading();
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
    const unfollow = reading.onBegin((started) =>
      setReplay(sentenceOf.filter((sentence) => sentence < started).length),
    );
    await reading.end().catch(() => undefined);
    unfollow();
    setReplay(undefined);
  };

  const save = async () => {
    const spaceId = windowSpace(spacesSnapshot().spaces)?.id;
    if (!spaceId) {
      setNotice("Open a Space in this window to save sketches to its Files.");
      return;
    }
    setSaving(true);
    setNotice("");
    try {
      const { convertToExcalidrawElements } = await import("@excalidraw/excalidraw");
      const elements = convertToExcalidrawElements(
        sketchSkeleton(sketch.elements) as Parameters<typeof convertToExcalidrawElements>[0],
      );
      const file = JSON.stringify({
        type: "excalidraw",
        version: 2,
        source: "misty",
        elements,
        appState: {},
        files: {},
      });
      const name = `${(sketch.header.title || "Sketch from Misty").replace(/[\\/:*?"<>|]/g, " ").trim()}.excalidraw`;
      await spacesGateway
        .get()
        .saveToDrive(spaceId, "/", name, new Blob([file], { type: "application/json" }));
      notify({ message: `Saved ${name} to Files` });
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
              icon={Shapes}
              disabled={!sketch.done || !count || saving}
              onClick={() => void save()}
            >
              Save to Files
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
