import { sourceToDrawing, type ImageEdit, type Mark } from "./imageEdit";
import type { Drawn } from "./imageRender";
import { drawSticker } from "./stickers";

/**
 * Drawing an edit's marks (pen, lines, arrows, shapes, text, redactions and stickers) over a
 * drawing of the photo, for the preview and for the saved file alike.
 */
/** A canvas only for measuring text, shared by every measure. */
let measuringContext: CanvasRenderingContext2D | null = null;

const textFont = (pixels: number) =>
  `600 ${pixels}px Inter, ui-sans-serif, system-ui, -apple-system, sans-serif`;
const textLineHeight = 1.22;

/** A text mark's lines and its box, in the original's pixels for an image `side` pixels long. */
export function textMetrics(text: string, size: number, side: number) {
  const pixels = Math.max(1, size * side);
  const lines = text.split("\n");
  measuringContext ??= document.createElement("canvas").getContext("2d");
  let width = 0;
  if (measuringContext) {
    measuringContext.font = textFont(pixels);
    for (const line of lines) width = Math.max(width, measuringContext.measureText(line).width);
  } else {
    width = Math.max(...lines.map((line) => line.length)) * pixels * 0.55;
  }
  return { lines, pixels, width, height: lines.length * pixels * textLineHeight };
}

/** Marks in stacking order, lowest first. */
export function orderedMarks(marks: Record<string, Mark>): Mark[] {
  return Object.values(marks).sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : 1));
}

/**
 * Draws the edit's marks over a drawing of it, where `drawn` says how the photo was drawn.
 * `photo` is the drawing of the photo alone, which redactions blur from. `extra` adds marks
 * being drawn right now (one's own and others'); `hidden` leaves out marks being dragged.
 */
export function drawMarks(
  context: CanvasRenderingContext2D,
  edit: ImageEdit,
  drawn: Drawn,
  options: { photo: HTMLCanvasElement; extra?: Mark[]; hidden?: ReadonlySet<string> },
) {
  const { source } = drawn;
  const side = Math.max(source.width, source.height);
  const matrix = sourceToDrawing(edit, source, { scale: drawn.scale, crop: drawn.crop });
  const marks = orderedMarks(edit.marks).filter((mark) => !options.hidden?.has(mark.id));
  if (options.extra) marks.push(...options.extra);
  for (const mark of marks) {
    context.save();
    if (mark.kind === "redact") drawRedaction(context, mark, matrix, side, options.photo);
    else {
      context.setTransform(matrix);
      drawMark(context, mark, side);
    }
    context.restore();
  }
  context.setTransform(1, 0, 0, 1, 0, 0);
}

/** One mark in the original's pixel space (the context's transform takes it to the drawing). */
function drawMark(context: CanvasRenderingContext2D, mark: Mark, side: number) {
  const px = (value: number) => value * side;
  context.strokeStyle = mark.color;
  context.fillStyle = mark.color;
  context.lineWidth = Math.max(0.5, px(mark.size));
  context.lineCap = "round";
  context.lineJoin = "round";
  switch (mark.kind) {
    case "pen": {
      const points = mark.points;
      context.beginPath();
      if (points.length === 1) {
        context.arc(px(points[0].x), px(points[0].y), context.lineWidth / 2, 0, Math.PI * 2);
        context.fill();
        return;
      }
      context.moveTo(px(points[0].x), px(points[0].y));
      // Through the midpoints, curving at each point, so a stroke reads as drawn, not plotted.
      for (let index = 1; index < points.length - 1; index++) {
        const point = points[index];
        const next = points[index + 1];
        context.quadraticCurveTo(
          px(point.x),
          px(point.y),
          px((point.x + next.x) / 2),
          px((point.y + next.y) / 2),
        );
      }
      const last = points[points.length - 1];
      context.lineTo(px(last.x), px(last.y));
      context.stroke();
      return;
    }
    case "line":
    case "arrow": {
      const from = { x: px(mark.from.x), y: px(mark.from.y) };
      const to = { x: px(mark.to.x), y: px(mark.to.y) };
      const length = Math.hypot(to.x - from.x, to.y - from.y);
      if (mark.kind === "line" || length < 1) {
        context.beginPath();
        context.moveTo(from.x, from.y);
        context.lineTo(to.x, to.y);
        context.stroke();
        return;
      }
      const angle = Math.atan2(to.y - from.y, to.x - from.x);
      const head = Math.min(length * 0.6, Math.max(context.lineWidth * 3.6, 10));
      const spread = Math.PI / 7;
      // The shaft stops inside the head, so its round end never shows past the point.
      const shaftEnd = {
        x: to.x - Math.cos(angle) * head * 0.7,
        y: to.y - Math.sin(angle) * head * 0.7,
      };
      context.beginPath();
      context.moveTo(from.x, from.y);
      context.lineTo(shaftEnd.x, shaftEnd.y);
      context.stroke();
      context.beginPath();
      context.moveTo(to.x, to.y);
      context.lineTo(
        to.x - Math.cos(angle - spread) * head,
        to.y - Math.sin(angle - spread) * head,
      );
      context.lineTo(
        to.x - Math.cos(angle + spread) * head,
        to.y - Math.sin(angle + spread) * head,
      );
      context.closePath();
      context.lineWidth = Math.max(0.5, context.lineWidth * 0.6);
      context.fill();
      context.stroke();
      return;
    }
    case "rect": {
      const { x, y, width, height } = mark.box;
      context.beginPath();
      context.rect(px(x), px(y), px(width), px(height));
      if (mark.fill) context.fill();
      else context.stroke();
      return;
    }
    case "ellipse": {
      const { x, y, width, height } = mark.box;
      context.beginPath();
      context.ellipse(
        px(x + width / 2),
        px(y + height / 2),
        Math.max(0.5, px(width / 2)),
        Math.max(0.5, px(height / 2)),
        0,
        0,
        Math.PI * 2,
      );
      if (mark.fill) context.fill();
      else context.stroke();
      return;
    }
    case "text": {
      if (!mark.text) return;
      const metrics = textMetrics(mark.text, mark.size, side);
      context.font = textFont(metrics.pixels);
      context.textBaseline = "top";
      metrics.lines.forEach((line, index) => {
        context.fillText(
          line,
          px(mark.at.x),
          px(mark.at.y) + index * metrics.pixels * textLineHeight,
        );
      });
      return;
    }
    case "sticker":
      drawSticker(context, mark, side);
      return;
    case "redact":
      return;
  }
}

/** Pixelates the photo under a redaction box, so what is under it can't be read. */
function drawRedaction(
  context: CanvasRenderingContext2D,
  mark: Extract<Mark, { kind: "redact" }>,
  matrix: DOMMatrix,
  side: number,
  photo: HTMLCanvasElement,
) {
  const { x, y, width, height } = mark.box;
  const corners = [
    [x, y],
    [x + width, y],
    [x + width, y + height],
    [x, y + height],
  ].map(([cx, cy]) => matrix.transformPoint(new DOMPoint(cx * side, cy * side)));
  const left = Math.max(0, Math.floor(Math.min(...corners.map((point) => point.x))));
  const top = Math.max(0, Math.floor(Math.min(...corners.map((point) => point.y))));
  const right = Math.min(photo.width, Math.ceil(Math.max(...corners.map((point) => point.x))));
  const bottom = Math.min(photo.height, Math.ceil(Math.max(...corners.map((point) => point.y))));
  if (right - left < 1 || bottom - top < 1) return;
  // Blocks scale with the drawing, so the preview and the saved file hide the same detail.
  const block = Math.max(4, Math.round(Math.max(photo.width, photo.height) / 64));
  const small = document.createElement("canvas");
  small.width = Math.max(1, Math.ceil((right - left) / block));
  small.height = Math.max(1, Math.ceil((bottom - top) / block));
  const smallContext = small.getContext("2d");
  if (!smallContext) return;
  smallContext.imageSmoothingEnabled = true;
  smallContext.imageSmoothingQuality = "medium";
  smallContext.drawImage(
    photo,
    left,
    top,
    right - left,
    bottom - top,
    0,
    0,
    small.width,
    small.height,
  );

  context.setTransform(matrix);
  context.beginPath();
  context.rect(x * side, y * side, width * side, height * side);
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clip();
  context.imageSmoothingEnabled = false;
  context.drawImage(
    small,
    0,
    0,
    small.width,
    small.height,
    left,
    top,
    small.width * block,
    small.height * block,
  );
  context.imageSmoothingEnabled = true;
}
