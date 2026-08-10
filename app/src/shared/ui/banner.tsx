import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import * as React from "react";

import { cn } from "./utils";

/**
 * Notification banner using the fixed warm-charcoal palette.
 *
 * Compose it as:
 *   <Banner variant="warning" onDismiss={fn}>
 *     <BannerIcon><TriangleAlert /></BannerIcon>
 *     <BannerContent>
 *       <BannerTitle>Heads up</BannerTitle>
 *       <BannerDescription>Something needs a look.</BannerDescription>
 *     </BannerContent>
 *     <BannerActions>
 *       <Button size="sm">Review</Button>
 *     </BannerActions>
 *   </Banner>
 */
const bannerVariants = cva(
  [
    "group/banner relative flex w-full items-start gap-3 rounded-lg border px-3.5 py-3",
    "text-left text-sm shadow-sm *:[svg]:size-4 *:[svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        default:
          "border-charcoal-border bg-charcoal-card text-cream [&_[data-slot=banner-icon]]:text-cream-muted",
        info: "border-sage-fg/30 bg-sage-bg text-cream [&_[data-slot=banner-icon]]:text-sage-fg",
        success:
          "border-status-green/30 bg-sage-bg text-cream [&_[data-slot=banner-icon]]:text-sage-fg",
        warning: "border-sage-fg/35 bg-sage-bg text-cream [&_[data-slot=banner-icon]]:text-sage-fg",
        danger:
          "border-charcoal-active/35 bg-charcoal-active text-cream [&_[data-slot=banner-icon]]:text-cream-bright",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

type BannerProps = React.ComponentProps<"div"> &
  VariantProps<typeof bannerVariants> & {
    /** When provided, renders a trailing close button that calls this handler. */
    onDismiss?: () => void;
    dismissLabel?: string;
  };

function Banner({
  className,
  variant,
  onDismiss,
  dismissLabel = "Dismiss",
  children,
  ...props
}: BannerProps) {
  return (
    <div
      data-slot="banner"
      role="status"
      aria-live="polite"
      className={cn(bannerVariants({ variant }), onDismiss && "pr-9", className)}
      {...props}
    >
      {children}
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={dismissLabel}
          title={dismissLabel}
          data-slot="banner-dismiss"
          className={[
            "absolute right-2 top-2 grid size-6 place-items-center rounded-md",
            "text-cream-muted opacity-70 transition hover:bg-charcoal-hover",
            "hover:text-cream hover:opacity-100 focus-visible:outline-none",
            "focus-visible:ring-2 focus-visible:ring-charcoal-active/50",
          ].join(" ")}
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

function BannerIcon({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="banner-icon"
      aria-hidden="true"
      className={cn("mt-0.5 flex shrink-0 *:[svg]:size-4", className)}
      {...props}
    />
  );
}

function BannerContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="banner-content"
      className={cn("grid min-w-0 flex-1 gap-0.5", className)}
      {...props}
    />
  );
}

function BannerTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="banner-title"
      className={cn(
        "font-medium leading-tight [&_a]:underline [&_a]:underline-offset-3",
        className,
      )}
      {...props}
    />
  );
}

function BannerDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="banner-description"
      className={cn(
        "min-w-0 text-sm text-cream-muted [overflow-wrap:anywhere] [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-cream",
        className,
      )}
      {...props}
    />
  );
}

function BannerActions({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="banner-action"
      className={cn("mt-0.5 flex shrink-0 items-center gap-2", className)}
      {...props}
    />
  );
}

export {
  Banner,
  BannerActions,
  BannerContent,
  BannerDescription,
  BannerIcon,
  BannerTitle,
  bannerVariants,
};
