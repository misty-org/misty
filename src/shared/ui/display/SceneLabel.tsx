import type { ReactNode } from "react";
import { cn } from "../classNames";
import { Pressable, type PressableProps } from "../controls/Pressable";
import { OverflowFadeText } from "../layout/OverflowFadeText";
import { Kbd } from "./Kbd";

/*
 * Labels laid over a full-color scene (the Studio's room): page text kept by what it names as the
 * scene moves, drawn in the art palette so it reads on any part of the picture in either theme.
 */

/** What the figure a SceneNameTag names is doing: working, waiting on its person, or at rest. */
export type SceneTagState = "working" | "waiting" | "resting";

export type SceneNameTagProps = Omit<PressableProps, "children"> & {
  /** The figure's name; it fades when long. */
  name: ReactNode;
  /** A small mark before the name, such as the engine's. */
  mark?: ReactNode;
  /** The second line: what it is on, or that it needs its person. Leave it out at rest. */
  line?: ReactNode;
  /** A glyph before the line, for the kind of work. */
  lineIcon?: ReactNode;
  state: SceneTagState;
  /** How its last run ended, while the person hasn't looked: the name takes that state's color. */
  outcome?: "done" | "failed";
  selected?: boolean;
};

/**
 * The name over a figure's head, as a game shows its players: plain white text with a tight dark
 * outline and no box, the line under it in the state's color. Picking it picks the figure; the
 * picked one, and the one under the pointer, light up green.
 */
export function SceneNameTag({
  name,
  mark,
  line,
  lineIcon,
  state,
  outcome,
  selected = false,
  className,
  ...props
}: SceneNameTagProps) {
  const nameColor =
    state === "resting" && outcome === "done"
      ? "text-state-done"
      : state === "resting" && outcome === "failed"
        ? "text-state-failed"
        : selected
          ? "text-art-green"
          : "group-hover/scene-tag:text-art-green";
  const lineColor =
    state === "working"
      ? "text-art-green"
      : state === "waiting"
        ? "text-state-waiting"
        : "text-art-white/75";
  return (
    <Pressable
      data-slot="scene-name-tag"
      className={cn(
        "group/scene-tag grid max-w-48 flex-none justify-items-center gap-px px-1 mb-1",
        "text-art-white select-none pointer-events-auto",
        // A tight outline: a wide glow is cut into a box by the fade that shortens long names.
        "[text-shadow:0_1px_1px_rgb(0_0_0/85%),0_0_0.125rem_rgb(0_0_0/75%)]",
        className,
      )}
      {...props}
    >
      <span
        className={cn(
          "flex max-w-full items-center gap-1 whitespace-nowrap text-caption font-bold",
          "[&_svg]:flex-none [&_svg]:drop-shadow-[0_1px_1px_rgb(0_0_0/80%)]",
          nameColor,
        )}
      >
        {mark}
        <OverflowFadeText>{name}</OverflowFadeText>
      </span>
      {line ? (
        <span
          className={cn(
            "flex max-w-full items-center gap-1 whitespace-nowrap text-micro font-semibold",
            lineColor,
          )}
        >
          {lineIcon}
          <OverflowFadeText>{line}</OverflowFadeText>
        </span>
      ) : null}
    </Pressable>
  );
}

/** What a figure is saying, in a white rounded bubble over its head, at most four lines. */
export function SceneBubble({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      data-slot="scene-bubble"
      className={cn(
        "relative grid w-max max-w-58 flex-none place-items-center mb-1.5 rounded-xl px-2.5 py-1.5",
        "bg-[rgb(250_250_250/94%)] text-art-ink text-caption shadow-[0_0.25rem_0.875rem_rgb(0_0_0/28%)]",
        "select-none",
        className,
      )}
    >
      <OverflowFadeText lines={4}>{children}</OverflowFadeText>
    </span>
  );
}

/**
 * A small plate naming a place in the scene, such as whose a desk is. `empty` dims it, for a place
 * nobody has taken.
 */
export function ScenePlate({
  children,
  empty = false,
  className,
}: {
  children: ReactNode;
  empty?: boolean;
  className?: string;
}) {
  return (
    <span
      data-slot="scene-plate"
      data-empty={empty || undefined}
      className={cn(
        "block whitespace-nowrap rounded-md px-2 py-0.5 text-micro font-medium leading-4",
        empty ? "bg-[rgb(20_20_20/62%)] text-art-gray" : "bg-[rgb(250_250_250/92%)] text-art-ink",
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * A small sign standing in the scene that can be picked, the way a game marks a plot to take. At
 * rest it is a dot holding its glyph; under the pointer or with focus it opens to its word. It
 * wears the scene panels' solid card, so it reads on any part of the picture. The word is always
 * its accessible name.
 */
export function SceneSign({
  icon,
  children,
  className,
  ...props
}: Omit<PressableProps, "wash"> & { icon?: ReactNode }) {
  return (
    <Pressable
      data-slot="scene-sign"
      className={cn(
        "group/sign mb-0.5 flex h-7 min-w-7 items-center justify-center gap-1.5 rounded-full px-1.5",
        "pointer-events-auto bg-charcoal-sidebar text-control font-medium text-cream-bright",
        "hairline-outline",
        "outline-[color-mix(in_srgb,var(--misty-theme-text)_14%,transparent)]",
        "shadow-[0_0.125rem_0.5rem_rgb(0_0_0/0.35)] transition-[padding] duration-150",
        "hover:pr-2.5 focus-visible:pr-2.5",
        className,
      )}
      {...props}
    >
      <span className="grid size-4 shrink-0 place-items-center rounded-full bg-cream-bright text-charcoal-bg [&_svg]:size-3">
        {icon}
      </span>
      <span className="hidden whitespace-nowrap group-hover/sign:inline group-focus-visible/sign:inline">
        {children}
      </span>
    </Pressable>
  );
}

/**
 * The studio's HUD colors: the app's soft pastels (`--color-avatar-*`, Gruvbox-inspired), the one
 * place the interface itself is colored, since the studio is a game. Each thing on the HUD keeps
 * its own tint wherever it shows (the Break slot and a break are always orange). Selection stays
 * the neutral wash; a tint only marks what is lit, never fills a row.
 */
export type SceneTint = "red" | "orange" | "yellow" | "green" | "blue" | "purple" | "sand";

// Literal class names, so Tailwind finds them.
const tintText: Record<SceneTint, string> = {
  red: "text-avatar-red",
  orange: "text-avatar-orange",
  yellow: "text-avatar-yellow",
  green: "text-avatar-green",
  blue: "text-avatar-blue",
  purple: "text-avatar-purple",
  sand: "text-avatar-gray",
};
const tintFill: Record<SceneTint, string> = {
  red: "bg-avatar-red",
  orange: "bg-avatar-orange",
  yellow: "bg-avatar-yellow",
  green: "bg-avatar-green",
  blue: "bg-avatar-blue",
  purple: "bg-avatar-purple",
  sand: "bg-avatar-gray",
};

/** A glyph in its tint, standing bare as every icon does. */
export function SceneGlyph({ tint, children }: { tint: SceneTint; children: ReactNode }) {
  return (
    <span data-slot="scene-glyph" className={cn("inline-flex flex-none", tintText[tint])}>
      {children}
    </span>
  );
}

/** A small count in its tint's fill with dark ink, as a game shows a level ("Lv 5"). */
export function SceneBadge({ tint, children }: { tint: SceneTint; children: ReactNode }) {
  return (
    <span
      data-slot="scene-badge"
      className={cn(
        "inline-flex h-5 flex-none items-center rounded-md px-1.5 text-caption font-bold",
        "tabular-nums text-avatar-ink",
        tintFill[tint],
      )}
    >
      {children}
    </span>
  );
}

/**
 * How far something has got, as a game's experience bar: a rounded track with the tint filling
 * it. `value` runs from 0 to 100; the label is its accessible name.
 */
export function SceneMeter({
  tint,
  value,
  label,
  className,
}: {
  tint: SceneTint;
  value: number;
  label: string;
  className?: string;
}) {
  const share = Math.max(0, Math.min(100, value));
  return (
    <span
      data-slot="scene-meter"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(share)}
      className={cn("block h-1.5 overflow-hidden rounded-full bg-white/14", className)}
    >
      <span
        className={cn("block h-full rounded-full transition-[width] duration-500", tintFill[tint])}
        style={{ width: `${share}%` }}
      />
    </span>
  );
}

/**
 * One slot of a game's hotbar over the scene: a square holding a glyph in its tint and a short
 * word under it, with its number key in the corner, as players expect of a bar along the bottom of
 * a game. `selected` keeps it lit for what is in force now (the order the team is under): the
 * neutral pressed wash. `compact` folds the word away and the slot down to 40px, for a hotbar
 * resting small. The word is its accessible name unless `aria-label` says more.
 */
export function SceneSlot({
  icon,
  keyName,
  tint,
  children,
  selected = false,
  compact = false,
  className,
  ...props
}: Omit<PressableProps, "wash" | "selected"> & {
  icon: ReactNode;
  /** The key that presses it, shown in its corner. */
  keyName?: string;
  tint?: SceneTint;
  selected?: boolean;
  /** Just the glyph and its key, 40px tall; the word folds away. */
  compact?: boolean;
}) {
  return (
    <Pressable
      data-slot="scene-slot"
      wash="control"
      selected={selected}
      aria-pressed={selected}
      className={cn(
        "relative grid w-14 flex-none content-center justify-items-center rounded-lg px-1",
        "transition-[height] duration-150 ease-out motion-reduce:transition-none",
        compact ? "h-10" : "h-13",
        "text-cream",
        className,
      )}
      {...props}
    >
      {keyName ? (
        <span
          aria-hidden="true"
          className={cn(
            "absolute top-1 left-1.5 text-micro font-semibold leading-none",
            tint ? tintText[tint] : "text-cream-muted",
          )}
        >
          {keyName}
        </span>
      ) : null}
      {tint ? <SceneGlyph tint={tint}>{icon}</SceneGlyph> : icon}
      {/* The word is kept short enough to fit whole: a slot's label is never cut. */}
      <span
        className={cn(
          "overflow-hidden whitespace-nowrap text-micro font-medium leading-none",
          "transition-[max-height,margin,opacity] duration-150 ease-out motion-reduce:transition-none",
          compact ? "mt-0 max-h-0 opacity-0" : "mt-1 max-h-4",
        )}
      >
        {children}
      </span>
    </Pressable>
  );
}

/**
 * The key that does something with what the person walked up to, floating by it as a game shows
 * its prompts ("E Talk to Ada", "E Play games"). It wears the scene panels' solid card, so it reads
 * on any part of the picture; the key is the one the person presses, not a button.
 */
export function ScenePrompt({ keyName, children }: { keyName: string; children: ReactNode }) {
  return (
    <span
      data-slot="scene-prompt"
      role="status"
      className={cn(
        "mb-1.5 flex flex-none items-center gap-1.5 whitespace-nowrap rounded-lg py-1 pr-2.5 pl-1",
        "bg-charcoal-sidebar text-caption font-medium text-cream-bright",
        "hairline-outline",
        "outline-[color-mix(in_srgb,var(--misty-theme-text)_14%,transparent)]",
        "animate-[misty-fade-in_0.15s_ease-out] motion-reduce:animate-none",
      )}
    >
      <Kbd strong>{keyName}</Kbd>
      {children}
    </span>
  );
}

/**
 * What a figure just earned, rising off its head and fading ("+1" for a finished task): the name
 * tags' white-on-outline type, in the done tone.
 */
export function SceneReward({ children }: { children: ReactNode }) {
  return (
    <span
      data-slot="scene-reward"
      aria-hidden="true"
      className={cn(
        "mb-2 block whitespace-nowrap text-meta font-extrabold text-art-green",
        "[text-shadow:0_1px_1px_rgb(0_0_0/85%),0_0_0.125rem_rgb(0_0_0/75%)]",
        "animate-[misty-rise-fade_1.8s_ease-out_forwards] motion-reduce:animate-none",
      )}
    >
      {children}
    </span>
  );
}

/**
 * The dot in the middle of the view while the scene is walked through in first person, as a game
 * marks where the eyes point: what is ahead of it is what E talks to. A bright dot with a dark
 * edge, so it reads on any part of the picture; it never takes the pointer.
 */
export function SceneCrosshair({ className }: { className?: string }) {
  return (
    <span
      data-slot="scene-crosshair"
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 m-auto size-1.5 rounded-full",
        "bg-cream-bright ring-1 ring-charcoal-bg/60",
        className,
      )}
    />
  );
}
