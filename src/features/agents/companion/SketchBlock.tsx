import { useEffect, useMemo, useRef, useState } from "react";
import { PenLine } from "lucide-react";
import { drawingsApi } from "@/api/drawings/api";
import { collaborationOffMessage, isCollaborationOff } from "@/features/collaboration/localOnly";
import { Button, Skeleton } from "@/shared/ui";
import { useWorkspaceStore, workspaceSurfaceFromRoute } from "@/features/workspace";
import { useSpaceWindowStore } from "@/features/workspace/spaceWindow";
import { parseSketch, sketchSkeleton } from "./companionSketch";
import { renderSketch } from "./sketchRender";
import "./sketchBlock.css";

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
    const spaceId = useSpaceWindowStore.getState().space?.spaceId;
    if (!spaceId) {
      setNotice("Open a Space in this window to save drawings there.");
      return;
    }
    setSaving(true);
    setNotice("");
    try {
      const drawing = await drawingsApi.create(
        spaceId,
        sketch.header.title || "Drawing from Misty",
      );
      // Without collaboration the server can't keep the sketch: say so rather than open an
      // empty drawing.
      const saved = await drawingsApi.collaborationTicket(spaceId, drawing.id).then(
        () => true,
        (cause: unknown) => {
          if (!isCollaborationOff(cause)) return true;
          void drawingsApi.remove(spaceId, drawing.id).catch(() => undefined);
          return false;
        },
      );
      if (!saved) {
        setNotice(collaborationOffMessage);
        return;
      }
      const { convertToExcalidrawElements } = await import("@excalidraw/excalidraw");
      const { seedDrawing } = await import("@/features/journal/drawings/components/useDrawingSeed");
      seedDrawing(
        drawing.id,
        convertToExcalidrawElements(
          sketchSkeleton(sketch.elements) as Parameters<typeof convertToExcalidrawElements>[0],
        ) as Parameters<typeof seedDrawing>[1],
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
    <figure className="misty-sketch" aria-label={sketch.header.title || "Drawing"}>
      {sketch.header.title || sketch.header.surface === "screen" ? (
        <figcaption>
          {sketch.header.surface === "screen" ? "Marked on your screen" : sketch.header.title}
        </figcaption>
      ) : null}
      <div className="misty-sketch-canvas" ref={canvas}>
        {!drawn && <Skeleton className="misty-sketch-skeleton" />}
      </div>
      <div className="misty-sketch-actions">
        <Button
          variant="outline"
          size="sm"
          disabled={!sketch.done || !count || saving}
          onClick={() => void save()}
        >
          <PenLine size={14} aria-hidden="true" />
          Save as drawing
        </Button>
        {notice && (
          <p role="status" className="misty-sketch-notice">
            {notice}
          </p>
        )}
      </div>
    </figure>
  );
}
