import { cn, screenMarkClass, sketchInk } from "@misty/ui";
import { invoke } from "@tauri-apps/api/core";
import { mapSketch } from "./companionSketch";
import { createModelView, type ModelView } from "./modelView";
import { boardCardBox } from "./pointLayout";
import type { DisplayFrame, PresentedSketch } from "./protocol";
import { renderSketch, SKETCH_PADDING } from "./sketchRender";

/**
 * Paints the reply's drawing on one display's overlay. A board is a whiteboard card
 * beside the cursor, placed once when it first appears so it does not chase the
 * pointer; a model is the same card holding a 3D model (modelView.ts). Screen marks are
 * drawn where they belong, in white with a shadow. Each new line of the drawing re-renders
 * it, so it builds up while Misty explains.
 *
 * A model's card is the one part of the overlay the pointer can use (`modelCard` gives its box,
 * and the overlay loop takes the pointer over it): the model turns when it's dragged, and a click
 * on a part asks Tutor about that part.
 */
export function createSketchPainter(layer: HTMLDivElement) {
  let seen = "";
  let render = 0;
  let card: { id: string; x: number; y: number; width: number; height: number } | undefined;
  let frame: HTMLDivElement | undefined;
  /** The model on the card, made once per drawing. */
  let model: { id: string; view: Promise<ModelView | undefined> } | undefined;
  const dropModel = () => {
    void model?.view.then((view) => view?.dispose());
    model = undefined;
  };
  const paint = (
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
        dropModel();
        layer.replaceChildren();
      }
      return;
    }
    const pictures = sketch.elements.filter((e) => e.src).length;
    const key = `${sketch.id}:${sketch.elements.length}:${pictures}:${sketch.done}:${display.id}:${factor}`;
    if (key === seen) return;
    seen = key;
    const ticket = ++render;
    if (model && model.id !== sketch.id) dropModel();
    if (sketch.surface === "board" || sketch.surface === "model") {
      // One card per drawing, placed once beside where the cursor is (the middle when
      // it is elsewhere); each new line only redraws what is inside it.
      if (!onCard || !frame) {
        dropModel();
        const anchor = cursorHere ? mouse : { x: width / 2, y: height / 2 };
        card = { id: sketch.id, ...boardCardBox(anchor, width, height) };
        frame = document.createElement("div");
        frame.className = cn(
          "absolute top-0 left-0 flex flex-col px-3 pt-2.5 pb-3",
          "animate-[misty-fade-in_0.2s_ease-out] motion-reduce:animate-none",
          screenMarkClass.board,
        );
        frame.style.transform = `translate(${card.x}px, ${card.y}px)`;
        frame.style.width = `${card.width}px`;
        frame.style.height = `${card.height}px`;
        if (sketch.title) {
          const title = document.createElement("div");
          title.className =
            "mb-1 overflow-hidden whitespace-nowrap text-caption font-medium [mask-image:var(--mask-fade-end)]";
          title.textContent = sketch.title;
          frame.append(title);
        }
        layer.replaceChildren(frame);
      }
      const board = frame;
      if (sketch.surface === "model") {
        if (!model) {
          const stage = document.createElement("div");
          stage.className = "min-h-0 w-full flex-1";
          board.append(stage);
          board.style.pointerEvents = "auto";
          model = {
            id: sketch.id,
            view: createModelView(stage, {
              draggable: true,
              onPick: (part) =>
                void invoke("cursor_companion_ask_part", { part: part.label || part.id }).catch(
                  () => undefined,
                ),
            }).catch(() => undefined),
          };
        }
        const parts = sketch.elements;
        // The part being talked about is the last one with words of its own.
        const current = [...parts].reverse().find((part) => part.say)?.id;
        void model.view.then((view) => {
          if (ticket === render) view?.update(parts, current);
        });
        return;
      }
      void renderSketch(sketch.elements, sketchInk.board).then((drawn) => {
        if (ticket !== render || !drawn) return;
        drawn.svg.classList.add("min-h-0", "w-full", "h-full", "flex-1");
        drawn.svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
        board.querySelector("svg")?.remove();
        board.append(drawn.svg);
      });
      return;
    }
    frame = undefined;
    dropModel();
    const local = mapSketch(sketch.elements, {
      scaleX: 1 / factor,
      scaleY: 1 / factor,
      dx: -display.x / factor,
      dy: -display.y / factor,
    });
    void renderSketch(local, sketchInk.screen).then((drawn) => {
      if (ticket !== render) return;
      if (!drawn) return void layer.replaceChildren();
      drawn.svg.classList.add(
        "absolute",
        "top-0",
        "left-0",
        "overflow-visible",
        ...screenMarkClass.strokes.split(" "),
      );
      drawn.svg.style.transform = `translate(${drawn.bounds.x - SKETCH_PADDING}px, ${drawn.bounds.y - SKETCH_PADDING}px)`;
      layer.replaceChildren(drawn.svg);
    });
  };
  /** The model's card on this display, in the overlay's own units, while one is shown. */
  const modelCard = () => (model && card && frame ? card : undefined);
  return Object.assign(paint, { modelCard });
}
