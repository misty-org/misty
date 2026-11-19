import { Slot, Slottable } from "@radix-ui/react-slot";
import * as React from "react";

import { cn } from "../classNames";
import { controlFrame } from "./controlFrame";
import { useCompactControls } from "./RowContext";

/**
 * The four roles. primary is the one filled call to action on a surface (at most one);
 * secondary is the bordered everyday button; quiet is a wash on hover and nothing else, for
 * toolbars and inline actions; danger is only for what deletes.
 *
 * A button never shows loading. While its work runs it is just disabled, and progress shows
 * where the work happens: the row, item or content it changes.
 */
export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";

/** The three heights: sm 24, md 32 (the default), lg 36, which belongs to dialogs and empty states. */
export type ButtonSize = "sm" | "md" | "lg";

/**
 * `overlay` is the one sanctioned look outside the four roles: a dark translucent disc for
 * controls drawn over images, video and the Studio, where a role would vanish into the picture.
 * Only media viewers and the Studio use it, usually through IconButton.
 */
/**
 * Two looks past the four roles: `overlay` for controls over images and video, and `soft`, a
 * solid square in a soft wash, for a button that stands in another's place in a slot (Stop in
 * Send's place while a reply runs).
 */
export type ButtonLook = ButtonVariant | "overlay" | "soft";

export type ButtonJustify = "center" | "start" | "end" | "between" | "none";

type IconComponent = React.ComponentType<{
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
}>;

/** A glyph for `icon` and `iconEnd`: a Lucide icon (or any icon component), or an element. */
export type ButtonIcon = IconComponent | React.ReactNode;

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Defaults to secondary. */
  variant?: ButtonLook | null;
  /** Defaults to md (32). */
  size?: ButtonSize | null;
  justify?: ButtonJustify | null;
  /** The 16px glyph before the label. */
  icon?: ButtonIcon;
  /** The 16px glyph after the label, such as a chevron or an arrow. */
  iconEnd?: ButtonIcon;
  /**
   * A short muted second line under the label, for one of a row of choices that says what
   * follows from it (a review grade and when the card comes back). The button stacks the two
   * lines, 48px tall and at least 96px wide; every choice in the row has one.
   */
  caption?: React.ReactNode;
  /**
   * Gives way first when its bar runs short: it narrows below its label, which fades out at the
   * cut (an `OverflowFadeText` label), as a breadcrumb's folder does.
   */
  shrink?: boolean;
  /**
   * Hugs a picture at its start (a Space's mark, a person's face), as a breadcrumb's place does:
   * the picture sits near the button's edge, so the button's edge lines up with the page's gutter.
   */
  snug?: boolean;
  /** Styles its one child instead, such as a router Link. */
  asChild?: boolean;
  /** Defaults to "button": a form's submit button says `type="submit"`. */
  type?: "button" | "submit" | "reset";
}

const baseClass = cn(
  "group/button inline-flex shrink-0 items-center border border-transparent",
  "bg-clip-padding text-control font-medium whitespace-nowrap",
  "transition-none outline-none select-none",
  "disabled:pointer-events-none disabled:opacity-50",
  "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
);

// Focus rings are off app-wide (base.css), so keyboard focus shows as the hover fill.
const variantClass: Record<ButtonLook, string> = {
  // Its fill reaches under the border, so it is as big as a bordered button beside it.
  primary: cn(
    "bg-cream-bright bg-clip-border text-charcoal-bg",
    "hover:bg-cream-action-hover focus-visible:bg-cream-action-hover",
    "aria-expanded:bg-cream-action-hover data-[state=open]:bg-cream-action-hover",
  ),
  secondary: cn(
    "border-charcoal-border-strong bg-transparent text-cream",
    "hover:border-charcoal-active hover:bg-charcoal-hover hover:text-cream-bright",
    "focus-visible:bg-charcoal-hover focus-visible:text-cream-bright",
    "aria-expanded:bg-charcoal-hover aria-expanded:text-cream-bright",
    "aria-pressed:bg-charcoal-hover aria-pressed:text-cream-bright",
    "data-[state=open]:bg-charcoal-hover data-[state=open]:text-cream-bright",
  ),
  // Washing with the text color keeps it right on light themes too. Its fill reaches under its
  // unseen border too, so a hovered or open quiet button is as big as the buttons beside it.
  quiet: cn(
    "bg-clip-border text-cream-muted hover:bg-control-hover hover:text-cream",
    "focus-visible:bg-control-hover focus-visible:text-cream",
    "aria-pressed:bg-control-active aria-pressed:text-cream",
    "aria-expanded:bg-control-active aria-expanded:text-cream",
    "data-[state=open]:bg-control-active data-[state=open]:text-cream",
    // A menu trigger whose setting is on, such as agent access.
    "data-[active=true]:bg-control-active data-[active=true]:text-cream",
  ),
  danger: cn(
    "border-charcoal-border-strong bg-transparent text-danger",
    "hover:bg-danger-wash focus-visible:bg-danger-wash",
    "aria-expanded:bg-danger-wash data-[state=open]:bg-danger-wash",
  ),
  // A solid square in a soft wash, as big as the button whose place it takes (MessageComposer).
  soft: cn(
    "bg-control-hover bg-clip-border text-cream hover:bg-control-active hover:text-cream-bright",
    "focus-visible:bg-control-active aria-pressed:text-cream-bright",
  ),
  // Controls drawn over images and video: a dark translucent disc that reads on any media.
  overlay: cn(
    "border-cream/10 bg-charcoal-bg/75 text-cream backdrop-blur-sm",
    "hover:bg-charcoal-bg/90 hover:text-cream-bright",
    "focus-visible:bg-charcoal-bg/90 focus-visible:text-cream-bright",
  ),
};

// A side with a glyph sits a little tighter, so the glyph and the label look centered.
const sizeClass: Record<ButtonSize, string> = {
  sm: cn(
    controlFrame.sm,
    "gap-1 px-2",
    "has-data-[icon=inline-start]:pl-1.5 has-data-[icon=inline-end]:pr-1.5",
  ),
  md: cn(
    controlFrame.md,
    "gap-1.5 px-3",
    "has-data-[icon=inline-start]:pl-2.5 has-data-[icon=inline-end]:pr-2.5",
  ),
  lg: cn(
    controlFrame.lg,
    "gap-1.5 px-4",
    "has-data-[icon=inline-start]:pl-3 has-data-[icon=inline-end]:pr-3",
  ),
};

// A snug button's picture sits close to its edges, the label a little further in.
const snugClass: Record<ButtonSize, string> = {
  sm: "pr-1.5 has-data-[icon=inline-start]:pl-0.5",
  md: "pr-2 has-data-[icon=inline-start]:pl-1",
  lg: "pr-3 has-data-[icon=inline-start]:pl-1.5",
};

const justifyClass: Record<ButtonJustify, string> = {
  center: "justify-center",
  start: "justify-start",
  end: "justify-end",
  between: "justify-between",
  none: "",
};

function buttonClassName(
  variant: ButtonLook,
  size: ButtonSize,
  justify: ButtonJustify,
  className?: string,
) {
  return cn(baseClass, variantClass[variant], sizeClass[size], justifyClass[justify], className);
}

// forwardRef and memo components (every Lucide icon) are objects, not functions.
function isIconComponent(icon: ButtonIcon): icon is IconComponent {
  if (typeof icon === "function") return true;
  return (
    typeof icon === "object" && icon !== null && !React.isValidElement(icon) && "$$typeof" in icon
  );
}

function renderIcon(icon: ButtonIcon, side: "inline-start" | "inline-end") {
  if (icon === null || icon === undefined || typeof icon === "boolean") return null;
  if (isIconComponent(icon)) {
    const Icon = icon;
    return <Icon data-icon={side} aria-hidden="true" />;
  }
  if (React.isValidElement(icon))
    return React.cloneElement(icon as React.ReactElement<Record<string, unknown>>, {
      "data-icon": side,
    });
  return icon;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      justify,
      icon,
      iconEnd,
      caption,
      shrink = false,
      snug = false,
      asChild = false,
      children,
      type,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : "button";
    const resolvedVariant = variant ?? "secondary";
    // A compact bar (the bottom bar) makes its buttons 24px, whatever the feature passed.
    const compact = useCompactControls();
    const resolvedSize = compact ? "sm" : (size ?? "md");
    const resolvedJustify = justify ?? "center";
    return (
      <Comp
        data-slot="button"
        data-variant={resolvedVariant}
        data-size={resolvedSize}
        data-justify={resolvedJustify}
        className={buttonClassName(
          resolvedVariant,
          resolvedSize,
          resolvedJustify,
          cn(
            caption != null && "h-12 min-w-24 flex-col gap-0",
            shrink && "min-w-0 shrink",
            snug && snugClass[resolvedSize],
            className,
          ),
        )}
        ref={ref}
        // A plain button unless it says otherwise, so one inside a form never submits it by
        // accident. With `asChild` the child (a link) keeps its own semantics.
        type={type ?? (asChild ? undefined : "button")}
        {...props}
      >
        {renderIcon(icon, "inline-start")}
        <Slottable>{children}</Slottable>
        {caption != null ? <span className="text-caption text-cream-muted">{caption}</span> : null}
        {renderIcon(iconEnd, "inline-end")}
      </Comp>
    );
  },
);
Button.displayName = "Button";

export { Button };
