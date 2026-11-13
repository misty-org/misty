import type { ReactNode } from "react";
import { cn } from "../classNames";
import { Pressable, type PressableProps } from "../controls/Pressable";
import { OverflowFadeText } from "../layout/OverflowFadeText";

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
        "[text-shadow:0_1px_1px_rgb(0_0_0/85%),0_0_2px_rgb(0_0_0/75%)]",
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
        "bg-[rgb(250_250_250/94%)] text-art-ink text-caption shadow-[0_4px_14px_rgb(0_0_0/28%)]",
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
        "outline-[0.5px] outline-solid -outline-offset-[0.5px]",
        "outline-[color-mix(in_srgb,var(--misty-theme-text)_14%,transparent)]",
        "shadow-[0_2px_8px_rgb(0_0_0/0.35)] transition-[padding] duration-150",
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
