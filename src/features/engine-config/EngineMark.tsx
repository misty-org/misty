// The official marks of the engines Misty has adapters for, so an agent shows which engine it
// runs on. The shapes in engineMarks.json come from lobe-icons (https://github.com/lobehub/lobe-icons,
// MIT, Copyright (c) 2023 LobeHub), @lobehub/icons-static-svg 1.102.0, unchanged but for attribute
// names React reads; Codex wears OpenAI's own mark from there. Oh My Pi's is its own icon, from
// https://github.com/can1357/oh-my-pi (assets/icon.svg, MIT), its white drawn in the text colour so
// it shows on a light theme too. The marks belong to their owners and only name their products.
import { createElement, useId, type ReactNode } from "react";
import shapes from "./engineMarks.json";

/** One SVG element: its tag, its attributes, and its children, if any. */
type Shape = [string, Record<string, string>, Shape[]?];
type Mark = [Record<string, string>, Shape[]];

const marks = shapes as unknown as Record<string, Mark>;

/**
 * Whether an engine has a mark. Misty's own engine does not: it keeps the cloud. An engine with no
 * mark shows its initial instead.
 */
export const hasEngineMark = (engine: string | undefined): engine is string =>
  Boolean(engine && marks[engine]);

/** A mark's ids and the references to them, made this instance's own so gradients never clash. */
function own(attributes: Record<string, string>, prefix: string): Record<string, string> {
  return Object.fromEntries(
    Object.entries(attributes).map(([name, value]) => [
      name,
      name === "id" ? `${prefix}${value}` : value.replace(/url\(#/g, `url(#${prefix}`),
    ]),
  );
}

function draw(shape: Shape, prefix: string, key: number): ReactNode {
  const [tag, attributes, children = []] = shape;
  return createElement(
    tag,
    { key, ...own(attributes, prefix) },
    ...children.map((child, index) => draw(child, prefix, index)),
  );
}

/** An engine's official mark at the size of the text around it, or of `size` pixels. */
export function EngineMark({ engine, size }: { engine: string; size?: number }) {
  const prefix = `mark${useId().replace(/[^A-Za-z0-9_-]/g, "")}-`;
  const mark = marks[engine];
  if (!mark) return null;
  const [root, children] = mark;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size ?? "1em"}
      height={size ?? "1em"}
      aria-hidden="true"
      {...root}
    >
      {children.map((child, index) => draw(child, prefix, index))}
    </svg>
  );
}
