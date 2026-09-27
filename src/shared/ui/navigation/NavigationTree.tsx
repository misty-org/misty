export const navigationTreeGroupClass = "grid gap-1";
// Nested rows share the primary navigator row; hierarchy is only a small indent.
export const navigationTreeIndentClass = "ml-3";
export const navigationTreeRowClass = `group/tree-row relative ${navigationTreeIndentClass} flex h-[var(--navigation-row-height,32px)] items-center border-0 p-0 text-[length:var(--navigation-row-font-size,13px)]`;
// Keep hover feedback paint-only. Transitioning the surface underneath filtered
// brand marks makes WebKit/Chromium repeatedly rasterize them, which looks like
// the glyph is shifting even though its layout box never moves.
export const navigationTreeSurfaceClass =
  "grid h-full min-w-0 flex-1 grid-cols-[var(--navigation-primary-icon-slot,18px)_minmax(0,1fr)] items-center gap-2.5 rounded-md px-2.5 group-hover/tree-row:bg-charcoal-hover group-hover/tree-row:text-cream-bright group-aria-[current=page]/tree-row:bg-charcoal-hover group-data-[selected=true]/tree-row:bg-charcoal-hover";
export const navigationTreeIconClass =
  "pointer-events-none flex size-[var(--navigation-primary-icon-slot,18px)] shrink-0 items-center justify-center [transform:translateZ(0)] [backface-visibility:hidden] [&_[data-app-icon]]:!size-[var(--navigation-primary-icon-size,18px)] [&_svg]:!size-[var(--navigation-primary-icon-size,18px)] [&_svg]:overflow-visible [&_img]:!size-[var(--navigation-primary-icon-size,18px)]";
export const navigationTreeContentInsetClass = "px-2.5";
export const navigationDisclosureLabelClass = "flex min-w-0 items-center gap-1";
export const navigationDisclosureChevronClass = "shrink-0";
