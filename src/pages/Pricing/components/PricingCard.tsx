import { Check } from "lucide-react";
import { NavLink } from "react-router";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface PricingCardProps {
  name: string;
  price: string;
  period?: string;
  billingNote: string;
  description?: string;
  features: readonly string[];
  /** Renders a leading "Everything in <tier>" row above the added features. */
  inheritsFrom?: string;
  popular?: boolean;
  ctaHref?: string;
  ctaLabel: string;
  ctaBusy?: boolean;
  onCtaClick?: () => void;
}

export default function PricingCard({
  name,
  price,
  period,
  billingNote,
  description,
  features,
  inheritsFrom,
  popular = false,
  ctaHref,
  ctaLabel,
  ctaBusy = false,
  onCtaClick,
}: PricingCardProps) {
  const externalCta = ctaHref ? /^https:\/\//i.test(ctaHref) : false;

  return (
    <article
      className={cn(
        "relative flex flex-col rounded-xl border bg-card p-5 shadow-sm md:p-6",
        popular
          ? "border-primary/50 shadow-md ring-1 ring-primary/20"
          : "border-border",
      )}
    >
      {popular ? (
        <span className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary px-3 py-1 text-[11px] font-medium text-primary-foreground shadow-sm">
          Recommended
        </span>
      ) : null}

      <div className="border-b border-border pb-5">
        <h3 className="text-xl font-medium tracking-[-0.02em] text-foreground">
          {name}
        </h3>
        {description ? (
          <p className="mt-1.5 text-sm leading-5 text-muted-foreground">
            {description}
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap items-baseline gap-1.5">
          <span className="text-4xl font-medium tracking-[-0.05em] text-foreground">
            {price}
          </span>
          {period && (
            <span className="text-sm text-muted-foreground">{period}</span>
          )}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{billingNote}</p>
      </div>

      <div className="flex flex-1 flex-col pt-5">
        <ul className="mb-5 flex flex-1 flex-col gap-2.5">
          {inheritsFrom ? (
            <li className="flex gap-2.5 text-sm font-medium leading-5 text-foreground">
              <span className="mt-px flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-foreground">
                <Check aria-hidden="true" className="size-2.5" />
              </span>
              <span>Everything in {inheritsFrom}</span>
            </li>
          ) : null}
          {features.map((feature) => (
            <li
              key={feature}
              className="flex gap-2.5 text-sm leading-5 text-muted-foreground"
            >
              <span className="mt-px flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-foreground">
                <Check aria-hidden="true" className="size-2.5" />
              </span>
              <span>{feature}</span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        {onCtaClick ? (
          <Button
            type="button"
            className="h-11 w-full px-4 text-sm"
            disabled={ctaBusy}
            aria-busy={ctaBusy}
            onClick={onCtaClick}
          >
            {ctaBusy ? "Opening checkout…" : ctaLabel}
          </Button>
        ) : ctaHref ? (
          <Button
            asChild
            variant="outline"
            className="h-11 w-full px-4 text-sm"
          >
            {externalCta ? (
              <a href={ctaHref} target="_blank" rel="noopener noreferrer">
                {ctaLabel}
              </a>
            ) : (
              <NavLink to={ctaHref}>{ctaLabel}</NavLink>
            )}
          </Button>
        ) : null}
      </div>
    </article>
  );
}
