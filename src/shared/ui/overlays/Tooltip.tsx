import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as React from "react";

import { cn } from "../classNames";
import { Kbd } from "../display/Kbd";
import { popupMotionClass, popupSurfaceClass } from "./popupStyles";

/**
 * Misty's own tooltips: quick, one short label on the popup surface, with the command's shortcut
 * after it while shortcut hints are on. Never the system title.
 */

export type TooltipSide = "top" | "right" | "bottom" | "left";

type TooltipSettings = { shortcutHints: boolean };
const TooltipSettingsContext = React.createContext<TooltipSettings | null>(null);

/** Whether shortcuts show beside labels (Settings › Shortcuts › Show shortcut hints). */
function useShortcutHints() {
  return React.useContext(TooltipSettingsContext)?.shortcutHints ?? true;
}

export interface TooltipProviderProps {
  children?: React.ReactNode;
  /** How long the pointer rests on something before its first tooltip opens. */
  delayDuration?: number;
  /** After one tooltip closes, how long the next opens at once instead of waiting again. */
  skipDelayDuration?: number;
  /** The "Show shortcut hints" setting. A nested provider without it keeps its parent's. */
  shortcutHints?: boolean;
}

/** Mounted once at the app root, with the shortcut hints setting passed in. */
function TooltipProvider({
  children,
  delayDuration = 300,
  skipDelayDuration = 100,
  shortcutHints,
}: TooltipProviderProps) {
  const parentHints = useShortcutHints();
  const hints = shortcutHints ?? parentHints;
  const settings = React.useMemo(() => ({ shortcutHints: hints }), [hints]);
  return (
    <TooltipSettingsContext.Provider value={settings}>
      <TooltipPrimitive.Provider
        delayDuration={delayDuration}
        skipDelayDuration={skipDelayDuration}
      >
        {children}
      </TooltipPrimitive.Provider>
    </TooltipSettingsContext.Provider>
  );
}

// Radix throws without a provider. Tests and stories that render one component on its own get a
// provider of their own, with the app's defaults.
function WithProvider({ children }: { children: React.ReactNode }) {
  const settings = React.useContext(TooltipSettingsContext);
  if (settings) return <>{children}</>;
  return <TooltipProvider>{children}</TooltipProvider>;
}

const tooltipContentClass = cn(
  popupSurfaceClass,
  popupMotionClass,
  "layer-tooltip flex max-w-80 items-baseline gap-2 rounded-md px-2 py-1",
  "text-meta font-normal shadow-md select-none [overflow-wrap:anywhere]",
);

/** The bubble itself: portaled above everything, on the popup surface. */
function TooltipBubble({
  children,
  shortcut,
  side = "top",
  align,
}: {
  children: string;
  shortcut?: string;
  side?: TooltipSide;
  align?: TooltipProps["align"];
}) {
  const hints = useShortcutHints();
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        side={side}
        align={align}
        sideOffset={6}
        collisionPadding={8}
        data-slot="tooltip-content"
        data-popup-surface=""
        className={tooltipContentClass}
      >
        <span className="min-w-0">{children}</span>
        {shortcut && hints ? <Kbd data-slot="tooltip-shortcut">{shortcut}</Kbd> : null}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

export interface TooltipProps {
  /** What the element does or is, in sentence case. Empty shows no tooltip. */
  content: string;
  /** The command's shortcut as it reads, such as "⌘N". Shown only while shortcut hints are on. */
  shortcut?: string;
  /** Defaults to top; it flips when there's no room. */
  side?: TooltipSide;
  align?: "start" | "center" | "end";
  /** The one element it describes. It must take a ref and pointer and focus handlers. */
  children: React.ReactElement;
}

/**
 * A menu or dialog hands focus back to its trigger when it closes, and Radix opens the tooltip on
 * any focus, so it would pop up right after a click. Only focus from the keyboard opens it.
 */
function openOnKeyboardFocusOnly(event: React.FocusEvent<HTMLElement>) {
  let fromKeyboard = true;
  try {
    fromKeyboard = event.currentTarget.matches(":focus-visible");
  } catch {
    // An engine without :focus-visible treats every focus as the keyboard's.
  }
  if (!fromKeyboard) event.preventDefault();
}

/** `<Tooltip content="New chat" shortcut="⌘N"><Button … /></Tooltip>` */
function Tooltip({ content, shortcut, side, align, children }: TooltipProps) {
  if (!content) return children;
  return (
    <WithProvider>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild onFocus={openOnKeyboardFocusOnly}>
          {children}
        </TooltipPrimitive.Trigger>
        <TooltipBubble side={side} align={align} shortcut={shortcut}>
          {content}
        </TooltipBubble>
      </TooltipPrimitive.Root>
    </WithProvider>
  );
}

export { Tooltip, TooltipProvider, useShortcutHints };
