import type { ReactNode } from "react";

export function GallerySection(props: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="grid gap-4">
      <div className="grid gap-1 border-b border-charcoal-border pb-2">
        <h2 className="m-0 text-sm font-semibold text-cream-bright">{props.title}</h2>
        {props.note ? <p className="m-0 text-xs text-cream-muted">{props.note}</p> : null}
      </div>
      {props.children}
    </section>
  );
}

export function GalleryRow(props: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_minmax(0,1fr)] items-center gap-4">
      <span className="text-xs text-cream-muted">{props.label}</span>
      <div className="flex flex-wrap items-center gap-2">{props.children}</div>
    </div>
  );
}
