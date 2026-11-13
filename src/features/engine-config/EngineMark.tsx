// The official marks of the engines Misty has adapters for, so an agent shows which engine it
// runs on. The shapes in engineMarks.json come from lobe-icons (https://github.com/lobehub/lobe-icons,
// MIT, Copyright (c) 2023 LobeHub), @lobehub/icons-static-svg 1.102.0, unchanged but for attribute
// names React reads, in each engine's colored version where lobe-icons has one (Codex, Qoder,
// DeepSeek for DeepSeek Harness); Hermes wears Hermes Agent's. Oh My Pi's is its own gradient π, from
// https://github.com/can1357/oh-my-pi (packages/collab-web/public/favicon.svg, MIT), without the
// favicon's dark tile. The marks belong to their owners and only name their products.
import { createElement, useId, type ReactNode } from "react";
import { LogoInitial, MistyMark } from "@/shared/ui";
import shapes from "./engineMarks.json";

/** One SVG element: its tag, its attributes, and its children, if any. */
type Shape = [string, Record<string, string>, Shape[]?];
type Mark = [Record<string, string>, Shape[]];

const marks = shapes as unknown as Record<string, Mark>;

/**
 * Whether an engine has artwork of its own. Misty's own engine does not: avatars keep the cloud,
 * and `EngineMark` draws Misty's mark. Any other engine with no artwork shows its initial.
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

/**
 * An engine's official mark at the size of the text around it, or of `size` pixels. Never blank:
 * Misty's engine shows Misty's mark, and an engine with no artwork its initial (from `name`).
 */
export function EngineMark({
  engine,
  size,
  name,
}: {
  engine: string;
  size?: number;
  name?: string;
}) {
  const prefix = `mark${useId().replace(/[^A-Za-z0-9_-]/g, "")}-`;
  const mark = marks[engine];
  if (!mark)
    return engine === "misty" ? (
      <MistyMark size={size ?? "1em"} />
    ) : (
      <LogoInitial name={name ?? engine} size={size ?? "1em"} />
    );
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
