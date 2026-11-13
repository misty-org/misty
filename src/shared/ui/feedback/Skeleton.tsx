import { cn } from "../classNames";
import { controlFrame } from "../controls/controlFrame";

/**
 * One placeholder block. Its fill is the control wash (text at 10%), so it shows on every surface
 * it lands on: the window, the sidebar, a settings card or a dialog.
 *
 * A skeleton stands in for data on its very first load only: once something has been shown, it
 * comes back from the cache (`useCachedResource`) and refreshes behind what is on screen. Every
 * skeleton takes the exact shape of what replaces it, so nothing moves when the data arrives.
 */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("misty-skeleton rounded-md bg-control-hover", className)}
      {...props}
    />
  );
}

/**
 * The shared controls a row ends in, at their real sizes: Button md and sm, IconButton,
 * Switch, Input or SecretField, Select, Badge, a short value, and a time.
 */
type SkeletonControlKind =
  "button" | "button-sm" | "icon" | "switch" | "field" | "select" | "badge" | "text" | "time";

const controlShapes: Record<SkeletonControlKind, string> = {
  // Controls wear the shared control frame, so a placeholder is the shape of what replaces it.
  button: cn(controlFrame.md, "w-20"),
  "button-sm": cn(controlFrame.sm, "w-16"),
  icon: cn(controlFrame.md, "w-8"),
  switch: "h-5 w-9 rounded-full",
  field: cn(controlFrame.md, "w-60"),
  select: cn(controlFrame.md, "w-40"),
  badge: "h-5 w-14 rounded-sm",
  text: "h-3.5 w-14 rounded-sm",
  time: "h-3 w-8 rounded-sm",
};

/** A placeholder at a shared control's exact size. `className` sets a width the real one has. */
function SkeletonControl({ kind, className }: { kind: SkeletonControlKind; className?: string }) {
  return <Skeleton className={cn("shrink-0", controlShapes[kind], className)} />;
}

/** A control at a row's end: its kind, or its kind with the real one's width (`w-48`). */
type SkeletonControlSpec = SkeletonControlKind | { kind: SkeletonControlKind; className?: string };

/** One or more controls at a row's right end, in order. */
type SkeletonTrailing = SkeletonControlSpec | readonly SkeletonControlSpec[] | false;

/** The controls a `trailing` value names, each as `{ kind, className }`. */
function trailingControls(trailing: SkeletonTrailing | undefined) {
  if (!trailing) return [];
  const specs: readonly SkeletonControlSpec[] =
    typeof trailing === "string" || !Array.isArray(trailing)
      ? [trailing as SkeletonControlSpec]
      : trailing;
  return specs.map((spec) => (typeof spec === "string" ? { kind: spec } : spec));
}

function TrailingControls({ trailing }: { trailing: SkeletonTrailing }) {
  const controls = trailingControls(trailing);
  if (!controls.length) return null;
  return (
    <div className="flex shrink-0 items-center gap-2">
      {controls.map((control, index) => (
        <SkeletonControl key={index} kind={control.kind} className={control.className} />
      ))}
    </div>
  );
}

const titleWidths = ["w-2/3", "w-1/2", "w-3/5", "w-2/5"];

/** Row shapes: a plain list, a settings row, and a card row (bordered rows in a framed card). */
const rowVariants = {
  list: { one: "min-h-8", two: "min-h-12 py-1.5", gap: "gap-2", inner: "gap-2", list: "gap-0.5" },
  settings: {
    one: "min-h-14 py-3",
    two: "min-h-19 py-3",
    gap: "gap-8",
    inner: "gap-4",
    list: "gap-0",
  },
  card: {
    one: "min-h-13 px-3 py-2.5",
    two: "min-h-15 px-3 py-2.5",
    gap: "gap-3",
    inner: "gap-3",
    list: "gap-0 divide-y divide-charcoal-border",
  },
} as const;

/** Leading shapes: a 16px icon, a 24px avatar, a 40px avatar, and a 32px tile. */
const leadingShapes = {
  icon: "size-4 rounded-sm",
  avatar: "size-6 rounded-full",
  "avatar-lg": "size-10 rounded-full",
  tile: "size-8 rounded-lg",
} as const;

/**
 * Placeholder rows shaped like the list that will replace them. Use instead of "Loading…" text;
 * `label` names what is loading for screen readers. Pick the `variant` the real rows use, the
 * number of text `lines`, the `leading` picture and the `trailing` controls, so the swap doesn't
 * move anything. A list of ListRows uses ListRowSkeleton; settings rows in a settings panel use
 * `SettingsRowSkeleton` in the settings feature, which keeps the panel's hairlines.
 */
function SkeletonList({
  label,
  rows = 3,
  variant = "list",
  leading = "none",
  lines = 1,
  trailing = false,
  rowClassName,
  className,
}: {
  label: string;
  rows?: number;
  variant?: keyof typeof rowVariants;
  leading?: keyof typeof leadingShapes | "none";
  lines?: 1 | 2;
  /** The controls at each row's right end, at their real sizes. `true` is a small button. */
  trailing?: SkeletonTrailing | true;
  rowClassName?: string;
  className?: string;
}) {
  const shape = rowVariants[variant];
  const end: SkeletonTrailing = trailing === true ? "button-sm" : trailing;
  // Settings and card rows set their title at body size; plain rows at the control size.
  const titleHeight = variant === "list" ? "h-3" : "h-4";
  return (
    <div
      role="status"
      aria-label={label}
      aria-busy="true"
      className={cn("grid", shape.list, className)}
    >
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className={cn(
            "flex items-center",
            shape.gap,
            lines === 2 ? shape.two : shape.one,
            rowClassName,
          )}
        >
          <div className={cn("flex min-w-0 flex-1 items-center", shape.inner)}>
            {leading !== "none" && <Skeleton className={cn("shrink-0", leadingShapes[leading])} />}
            <div className="grid min-w-0 flex-1 gap-2">
              <Skeleton className={cn(titleHeight, titleWidths[index % titleWidths.length])} />
              {lines === 2 && <Skeleton className="h-3 w-1/3" />}
            </div>
          </div>
          <TrailingControls trailing={end} />
        </div>
      ))}
    </div>
  );
}

const lineWidths = ["w-full", "w-11/12", "w-full", "w-4/5", "w-full", "w-2/3"];

/** A document page placeholder for previews and readers. */
function SkeletonDocument({
  label,
  paragraphs = 3,
  className,
}: {
  label: string;
  paragraphs?: number;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-label={label}
      aria-busy="true"
      className={cn("mx-auto grid w-full max-w-2xl gap-6 px-6 py-10", className)}
    >
      <span className="sr-only">{label}</span>
      <Skeleton className="h-6 w-1/2" />
      {Array.from({ length: paragraphs }, (_, paragraph) => (
        <div key={paragraph} className="grid gap-2.5">
          {Array.from({ length: 4 }, (_, line) => (
            <Skeleton
              key={line}
              className={cn("h-3", lineWidths[(paragraph + line) % lineWidths.length])}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Lines of code with their number gutter, for an editor or a diff: monospace lines at the code
 * view's 20px line height.
 */
function SkeletonCode({
  label,
  lines = 16,
  gutter = true,
  className,
}: {
  label: string;
  lines?: number;
  gutter?: boolean;
  className?: string;
}) {
  const widths = ["w-1/2", "w-3/4", "w-2/3", "w-5/6", "w-1/3", "w-3/5", "w-0", "w-2/5"];
  return (
    <div role="status" aria-label={label} aria-busy="true" className={cn("grid py-2", className)}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: lines }, (_, line) => (
        <div key={line} className="flex h-5 items-center gap-3 px-2">
          {gutter ? <Skeleton className="h-2.5 w-6 shrink-0 rounded-sm" /> : null}
          <Skeleton className={cn("h-2.5 rounded-sm", widths[line % widths.length])} />
        </div>
      ))}
    </div>
  );
}

export {
  Skeleton,
  SkeletonCode,
  SkeletonControl,
  SkeletonDocument,
  SkeletonList,
  trailingControls,
  type SkeletonControlKind,
  type SkeletonControlSpec,
  type SkeletonTrailing,
};
