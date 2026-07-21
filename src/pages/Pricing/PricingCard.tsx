import { NavLink } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";

const CheckIcon = ({ muted }: { muted?: boolean }) => (
  <svg
    className={`mt-0.5 h-4 w-4 shrink-0 ${muted ? "text-muted-foreground/50" : "text-primary"}`}
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={2}
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
  </svg>
);

interface PricingCardProps {
  name: string;
  price: string;
  period?: string;
  description: string;
  features: readonly string[];
  popular?: boolean;
  ctaHref: string;
  ctaLabel: string;
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
}: PricingCardProps) {
  const externalCta = /^https:\/\//i.test(ctaHref);

  return (
    <Card className="relative h-full min-h-[28rem] gap-0 rounded-2xl py-0">
      {popular ? <Badge className="absolute right-4 top-4">Recommended</Badge> : null}

      <CardHeader className={`p-6 pb-0 ${popular ? "pr-32" : ""}`}>
        <div className="mb-4">
          <h3 className="mb-0.5 text-2xl font-bold text-foreground">{name}</h3>
          <div className="mb-2 flex flex-wrap items-baseline gap-1.5">
            <span className="text-3xl font-bold tracking-tight text-foreground">{price}</span>
            {period && <span className="text-xs text-muted-foreground">{period}</span>}
          </div>
          <p className="text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col px-6 pb-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Plan limits
        </p>

        <ul className="mb-4 flex flex-1 flex-col gap-2">
          {features.map((feature) => (
            <li
              key={feature}
              className="flex items-start gap-2.5 text-sm text-muted-foreground"
            >
              <CheckIcon />
              <span>{feature}</span>
            </li>
          ))}
        </ul>
      </CardContent>

      <CardFooter className="px-6 pb-6">
        <Button asChild className="h-auto w-full rounded-xl px-6 py-2.5 shadow-sm">
          {externalCta ? (
            <a href={ctaHref} target="_blank" rel="noopener noreferrer">
              {ctaLabel}
            </a>
          ) : (
            <NavLink to={ctaHref}>{ctaLabel}</NavLink>
          )}
        </Button>
      </CardFooter>
    </Card>
  );
}
