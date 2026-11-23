import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ShapeSelection, Surface, Text, ViewportLayer } from "@misty/ui";
import { useEffect, useRef, useState } from "react";

const LEAST_DRAG = 6;
const LINE_OFFSET = 18;

interface Point {
  x: number;
  y: number;
}

export function TutorShotLayer() {
  const [on, setOn] = useState(false);
  const [pointer, setPointer] = useState<Point>();
  const [from, setFrom] = useState<Point>();
  const start = useRef<Point | undefined>(undefined);

  useEffect(() => {
    const stop = listen<{ on: boolean }>("misty://tutor-ask-capture", (event) => {
      setOn(event.payload.on);
      if (!event.payload.on) {
        start.current = undefined;
        setFrom(undefined);
        setPointer(undefined);
      }
    });
    return () => void stop.then((unlisten) => unlisten());
  }, []);

  if (!on) return null;

  const box =
    from && pointer
      ? {
          x: Math.min(from.x, pointer.x),
          y: Math.min(from.y, pointer.y),
          width: Math.abs(pointer.x - from.x),
          height: Math.abs(pointer.y - from.y),
        }
      : undefined;
  const dragged = box !== undefined && Math.max(box.width, box.height) >= LEAST_DRAG;

  return (
    <ViewportLayer
      layer="agent-surface"
      className="pointer-events-auto cursor-crosshair select-none"
      onPointerMove={(event) => setPointer({ x: event.clientX, y: event.clientY })}
      onPointerLeave={() => {
        if (!start.current) setPointer(undefined);
      }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        const at = { x: event.clientX, y: event.clientY };
        start.current = at;
        setFrom(at);
        setPointer(at);
      }}
      onPointerUp={(event) => {
        const began = start.current;
        start.current = undefined;
        setFrom(undefined);
        if (!began) return;
        const x = Math.min(began.x, event.clientX);
        const y = Math.min(began.y, event.clientY);
        const width = Math.abs(event.clientX - began.x);
        const height = Math.abs(event.clientY - began.y);
        if (Math.max(width, height) < LEAST_DRAG) {
          void invoke("cursor_companion_ask_dismiss").catch(() => undefined);
          return;
        }
        void invoke("cursor_companion_ask_shot", { x, y, width, height }).catch(() => undefined);
      }}
    >
      {box && dragged && (
        <div
          className="absolute"
          style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
        >
          <ShapeSelection
            outline={[
              { x: 0, y: 0 },
              { x: box.width, y: 0 },
              { x: box.width, y: box.height },
              { x: 0, y: box.height },
            ]}
          />
        </div>
      )}
      {pointer && !dragged && (
        <Surface
          tone="card"
          edge="hairline"
          radius="md"
          className="absolute px-2 py-1"
          style={{ left: pointer.x + LINE_OFFSET, top: pointer.y + LINE_OFFSET }}
        >
          <Text size="caption">Drag to take a screenshot</Text>
        </Surface>
      )}
    </ViewportLayer>
  );
}
