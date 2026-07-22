import { NavLink } from "react-router";
import { Button } from "@/components/ui/button";

interface PricingCardProps {
  name: string;
  price: string;
  period?: string;
  description: string;
  features: readonly string[];
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
  description,
  features,
  popular = false,
  ctaHref,
  ctaLabel,
  ctaBusy = false,
  onCtaClick,
}: PricingCardProps) {
  const externalCta = ctaHref ? /^https:\/\//i.test(ctaHref) : false;

  return (
    <article className="flex min-h-[30rem] flex-col rounded-xl bg-card p-6 shadow-xs ring-1 ring-foreground/10 md:p-8">
      <div className="min-h-48 border-b border-border pb-7">
        <div className="flex items-start justify-between gap-4">
          <h3 className="text-2xl font-medium tracking-[-0.03em] text-foreground">
            {name}
          </h3>
          {popular ? (
            <span className="pt-1 text-xs text-muted-foreground">
              Recommended
            </span>
          ) : null}
        </div>
        <div className="mt-8 flex flex-wrap items-baseline gap-2">
          <span className="text-4xl font-medium tracking-[-0.045em] text-foreground">
            {price}
          </span>
          {period && (
            <span className="text-xs text-muted-foreground">{period}</span>
          )}
        </div>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      </div>

      <div className="flex flex-1 flex-col pt-7">
        <p className="mb-3 text-sm text-foreground">Included</p>

        <ul className="mb-4 flex flex-1 flex-col divide-y divide-border border-y border-border">
          {features.map((feature) => (
            <li key={feature} className="py-2.5 text-sm text-muted-foreground">
              {feature}
            </li>
          ))}
        </ul>
      </div>

      <div className="pt-5">
        {onCtaClick ? (
          <Button
            type="button"
            className="h-11 w-full px-6"
            disabled={ctaBusy}
            aria-busy={ctaBusy}
            onClick={onCtaClick}
          >
            {ctaBusy ? "Opening checkout…" : ctaLabel}
          </Button>
        ) : ctaHref ? (
          <Button asChild className="h-11 w-full px-6">
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
