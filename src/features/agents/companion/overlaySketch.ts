import { mapSketch } from "./companionSketch";
import { boardCardBox } from "./pointLayout";
import type { DisplayFrame, PresentedSketch } from "./protocol";
import { renderSketch, SKETCH_PADDING } from "./sketchRender";

/**
 * Paints the reply's drawing on one display's overlay. A board is a whiteboard card
 * beside the cursor, placed once when it first appears so it does not chase the
 * pointer. Screen marks are drawn where they belong, in white with a shadow. Each new
 * line of the drawing re-renders it, so it builds up while Misty explains.
 */
export function createSketchPainter(layer: HTMLDivElement) {
  let seen = "";
  let render = 0;
  let card: { id: string; x: number; y: number; width: number; height: number } | undefined;
  let frame: HTMLDivElement | undefined;
  return (
    sketch: PresentedSketch | undefined,
    display: Pick<DisplayFrame, "id" | "x" | "y" | "width" | "height">,
    factor: number,
    mouse: { x: number; y: number },
  ) => {
    const width = display.width / factor;
    const height = display.height / factor;
    const cursorHere = mouse.x >= 0 && mouse.y >= 0 && mouse.x < width && mouse.y < height;
    // Each drawing has one display: the one it marks, or the one the person asked from.
    const here =
      sketch && (sketch.displayId === undefined ? cursorHere : sketch.displayId === display.id);
    const onCard = sketch && card?.id === sketch.id;
    if (!sketch || !here) {
      if (seen) {
        seen = "";
        card = undefined;
        frame = undefined;
        render++;
        layer.replaceChildren();
      }
      return;
    }
    const key = `${sketch.id}:${sketch.elements.length}:${sketch.done}:${display.id}:${factor}`;
    if (key === seen) return;
    seen = key;
    const ticket = ++render;
    if (sketch.surface === "board") {
      // One card per drawing, placed once beside where the cursor is (the middle when
      // it is elsewhere); each new line only redraws what is inside it.
      if (!onCard || !frame) {
        const anchor = cursorHere ? mouse : { x: width / 2, y: height / 2 };
        card = { id: sketch.id, ...boardCardBox(anchor, width, height) };
        frame = document.createElement("div");
        frame.className = "cursor-sketch-board";
        frame.style.transform = `translate(${card.x}px, ${card.y}px)`;
        frame.style.width = `${card.width}px`;
        frame.style.height = `${card.height}px`;
        if (sketch.title) {
          const title = document.createElement("div");
          title.className = "cursor-sketch-title";
          title.textContent = sketch.title;
          frame.append(title);
        }
        layer.replaceChildren(frame);
      }
      const board = frame;
      void renderSketch(sketch.elements, "#1e1e1e").then((drawn) => {
        if (ticket !== render || !drawn) return;
        drawn.svg.classList.add("cursor-sketch-svg");
        drawn.svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
        board.querySelector("svg")?.remove();
        board.append(drawn.svg);
      });
      return;
    }
    frame = undefined;
    const local = mapSketch(sketch.elements, {
      scaleX: 1 / factor,
      scaleY: 1 / factor,
      dx: -display.x / factor,
      dy: -display.y / factor,
    });
    void renderSketch(local, "#ffffff").then((drawn) => {
      if (ticket !== render) return;
      if (!drawn) return void layer.replaceChildren();
      drawn.svg.classList.add("cursor-sketch-marks");
      drawn.svg.style.transform = `translate(${drawn.bounds.x - SKETCH_PADDING}px, ${drawn.bounds.y - SKETCH_PADDING}px)`;
      layer.replaceChildren(drawn.svg);
    });
  };
}
