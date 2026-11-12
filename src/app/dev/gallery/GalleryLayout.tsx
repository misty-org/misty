import { cn, Separator, Text } from "@/shared/ui";
import type { ReactNode } from "react";

export function GallerySection(props: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-4" aria-label={props.title}>
      <div className="grid gap-2">
        <Text as="h2" size="page" weight="semibold" tone="bright">
          {props.title}
        </Text>
        <Separator />
      </div>
      {props.children}
    </section>
  );
}

/** One sample row: what it shows on the left, the components on the right. */
export function GalleryRow(props: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[160px_minmax(0,1fr)] items-center gap-4">
      <Text size="meta" tone="muted">
        {props.label}
      </Text>
      <div className="flex min-w-0 items-center gap-2">{props.children}</div>
    </div>
  );
}

/**
 * The same component at several widths, so how it gives way can be seen side by side. The
 * hairline under each sample shows where its width ends. The widths are the sample's, not a
 * layout the app uses.
 */
export function GalleryWidths(props: {
  label: string;
  widths: ReadonlyArray<number>;
  children: (width: number) => ReactNode;
}) {
  return (
    <div className="grid grid-cols-[160px_minmax(0,1fr)] items-start gap-4">
      <Text size="meta" tone="muted" className="pt-1">
        {props.label}
      </Text>
      <div className="grid min-w-0 gap-4">
        {props.widths.map((width) => (
          <div key={width} className="grid min-w-0 max-w-full gap-1" style={{ width }}>
            <Text size="caption" tone="muted">
              {width}px
            </Text>
            <div className="min-w-0 overflow-hidden">{props.children(width)}</div>
            <Separator />
          </div>
        ))}
      </div>
    </div>
  );
}

/** A labelled grid of samples: column headings across the top, one row per case. */
export function GalleryMatrix(props: {
  columns: ReadonlyArray<string>;
  rows: ReadonlyArray<{ label: string; cells: ReadonlyArray<ReactNode> }>;
}) {
  return (
    <div
      className="grid items-center gap-x-4 gap-y-3"
      style={{ gridTemplateColumns: `160px repeat(${props.columns.length}, max-content)` }}
    >
      <span />
      {props.columns.map((column) => (
        <Text key={column} size="caption" tone="muted">
          {column}
        </Text>
      ))}
      {props.rows.map((row) => (
        <div key={row.label} className="contents">
          <Text size="meta" tone="muted">
            {row.label}
          </Text>
          {row.cells.map((cell, index) => (
            <div key={`${row.label}-${props.columns[index]}`} className="flex items-center gap-2">
              {cell}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// A stand-in for media or the Studio's office, in full color, so overlay buttons and the
// floating panels' translucency show.
const stageClass = cn(
  "relative overflow-hidden rounded-md",
  "bg-[linear-gradient(135deg,var(--tone-working),var(--tone-done))]",
);

export function GalleryStage(props: { className?: string; children: ReactNode }) {
  return <div className={cn(stageClass, props.className)}>{props.children}</div>;
}

/** A fixed-size pane for samples that center themselves in their pane, such as EmptyState. */
export function GalleryPane(props: { children: ReactNode }) {
  return (
    <div className="grid w-full max-w-md gap-1">
      <div className="h-56">{props.children}</div>
      <Separator />
    </div>
  );
}
