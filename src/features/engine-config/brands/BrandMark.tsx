// The vendors' own marks on provider presets and Pi's and Oh My Pi's providers, the way
// desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong) shows them. The shapes in
// brandMarks.json come from lobe-icons (https://github.com/lobehub/lobe-icons, MIT, Copyright (c)
// 2023 LobeHub), @lobehub/icons-static-svg 1.102.0, unchanged but for attribute names React reads,
// the same way as the engines' marks (EngineMark.tsx). Single-colour marks draw in the text colour.
// The marks belong to their owners and only name their products.
import { Globe } from "lucide-react";
import { createElement, useId, type ReactNode } from "react";
import shapes from "./brandMarks.json";

type Shape = [string, Record<string, string>, Shape[]?];
type Mark = [Record<string, string>, Shape[]];

const marks = shapes as unknown as Record<string, Mark>;

/** A mark's file name in @lobehub/icons-static-svg, without `.svg` (`deepseek-color`). */
export type BrandMarkId = keyof typeof shapes;

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

function Mark({ mark, size }: { mark: Mark; size: number }) {
  const prefix = `brand${useId().replace(/[^A-Za-z0-9_-]/g, "")}-`;
  const [root, children] = mark;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" {...root}>
      {children.map((child, index) => draw(child, prefix, index))}
    </svg>
  );
}

/**
 * A provider's mark in the 32px slot rows use, bare; a globe when it has no public mark, never a
 * letter dressed up as a brand.
 */
export function BrandTile({ mark, size = 20 }: { mark: string | null | undefined; size?: number }) {
  const found = mark ? marks[mark] : undefined;
  return (
    <span className="flex size-8 shrink-0 items-center justify-center text-cream">
      {found ? (
        <Mark mark={found} size={size} />
      ) : (
        <Globe className="size-4 text-cream-muted" aria-hidden />
      )}
    </span>
  );
}

/** Just the mark, at `size` pixels, or nothing when there is none. */
export function BrandMark({ mark, size = 16 }: { mark: string | null | undefined; size?: number }) {
  const found = mark ? marks[mark] : undefined;
  return found ? <Mark mark={found} size={size} /> : null;
}
