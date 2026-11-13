import * as React from "react";

import { cn } from "../classNames";
import { Pressable } from "./Pressable";

/**
 * A link inside a line of text, such as the terms in a page's small print: underlined, in the
 * text's own color, brightening on hover. It is a button; the caller opens the page.
 *
 * ```tsx
 * By continuing you agree to our <InlineLink onClick={openTerms}>Terms</InlineLink>
 * ```
 */
const InlineLink = React.forwardRef<HTMLButtonElement, React.ComponentPropsWithoutRef<"button">>(
  ({ className, ...props }, ref) => (
    <Pressable
      ref={ref}
      data-slot="inline-link"
      className={cn("underline underline-offset-2 hover:text-cream-bright", className)}
      {...props}
    />
  ),
);
InlineLink.displayName = "InlineLink";

export { InlineLink };
