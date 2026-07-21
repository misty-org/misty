import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";

import { cn } from "@/ui";

/**
 * Notification-style banner built on the vega/zinc semantic tokens (the same
 * ones alert.tsx and popover.tsx consume). Colored variants tint the shared
 * --misty-info/success/warning/danger tokens rather than hardcoding hex, so
 * banners re-theme automatically across graphite/aurora/copper/light.
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
    "text-left text-sm shadow-sm backdrop-blur-sm *:[svg]:size-4 *:[svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        default:
          "border-border bg-card text-card-foreground [&_[data-slot=banner-icon]]:text-muted-foreground",
        info: "border-info/30 bg-info/10 text-foreground [&_[data-slot=banner-icon]]:text-info",
        success:
          "border-success/30 bg-success/10 text-foreground [&_[data-slot=banner-icon]]:text-success",
        warning:
          "border-warning/35 bg-warning/10 text-foreground [&_[data-slot=banner-icon]]:text-warning",
        danger:
          "border-destructive/35 bg-destructive/10 text-foreground [&_[data-slot=banner-icon]]:text-destructive",
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
            "text-muted-foreground opacity-70 transition hover:bg-foreground/10",
            "hover:text-foreground hover:opacity-100 focus-visible:outline-none",
            "focus-visible:ring-2 focus-visible:ring-ring/50",
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
        "min-w-0 text-sm text-muted-foreground [overflow-wrap:anywhere] [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground",
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
  BannerIcon,
  BannerContent,
  BannerTitle,
  BannerDescription,
  BannerActions,
  bannerVariants,
};
