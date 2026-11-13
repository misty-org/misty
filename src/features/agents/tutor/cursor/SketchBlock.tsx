import { useEffect, useMemo, useRef, useState } from "react";
import { PenLine } from "lucide-react";
import { Button, Skeleton, Surface, Text } from "@/shared/ui";
import {
  spacesSnapshot,
  useWorkspaceStore,
  windowSpace,
  workspaceSurfaceFromRoute,
} from "@/features/app-windows";
import { spacesGateway } from "../../spaces-gateway/spacesGateway";
import { parseSketch, sketchSkeleton } from "./companionSketch";
import { renderSketch } from "./sketchRender";

/**
 * A reply's drawing in the transcript (companionSketch.ts): the whiteboard itself, or
 * the marks Misty drew over the screen without the screenshot under them. Save as
 * drawing makes it a Space drawing anyone in the Space can keep editing.
 */
export function SketchBlock({ source }: { source: string }) {
  const sketch = useMemo(() => parseSketch("```misty-sketch\n" + source + "\n```"), [source]);
  const canvas = useRef<HTMLDivElement>(null);
  const [drawn, setDrawn] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const count = sketch?.elements.length ?? 0;
  // Redraw when a line completes, not on every token of the reply.
  const latest = useRef(sketch);
  latest.current = sketch;

  useEffect(() => {
    const elements = latest.current?.elements;
    if (!elements?.length) return;
    let current = true;
    void renderSketch(elements, "#1e1e1e")
      .then((result) => {
        if (!current || !result || !canvas.current) return;
        result.svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
        // The drawing itself (not a glyph) fills the board.
        result.svg.classList.add("size-full");
        canvas.current.replaceChildren(result.svg);
        setDrawn(true);
      })
      .catch(() => {
        if (current) setNotice("This drawing couldn't be shown.");
      });
    return () => {
      current = false;
    };
  }, [count]);

  if (!sketch) return null;

  const save = async () => {
    const spaceId = windowSpace(spacesSnapshot().spaces)?.id;
    if (!spaceId) {
      setNotice("Open a Space in this window to save drawings there.");
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
          sketch.header.title || "Drawing from Misty",
          convertToExcalidrawElements(
            sketchSkeleton(sketch.elements) as Parameters<typeof convertToExcalidrawElements>[0],
          ),
        );
      const surface = workspaceSurfaceFromRoute(
        `/spaces/${encodeURIComponent(spaceId)}/drawings/${encodeURIComponent(drawing.id)}`,
      );
      if (surface) useWorkspaceStore.getState().openSurface({ ...surface, forceNew: true });
    } catch {
      setNotice("Misty couldn't save this drawing. Try again.");
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
        className="grid h-70 place-items-center overflow-hidden p-3"
        ref={canvas}
      >
        {!drawn && <Skeleton className="size-full" />}
      </Surface>
      <div className="mt-2 flex items-center gap-2.5">
        <Button
          icon={PenLine}
          disabled={!sketch.done || !count || saving}
          onClick={() => void save()}
        >
          Save as drawing
        </Button>
        {notice && (
          <Text role="status" size="caption" tone="muted" wrap>
            {notice}
          </Text>
        )}
      </div>
    </figure>
  );
}
