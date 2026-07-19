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
  price: string | null;
  period?: string;
  description?: string;
  features: string[];
  inherits?: string;
  comingSoon?: boolean;
  popular?: boolean;
  ctaTo?: string;
  ctaHref?: string;
  ctaLabel?: string;
  ctaBusy?: boolean;
  onCtaClick?: () => void;
}

export default function PricingCard({
  name,
  price,
  period,
  description,
  features,
  inherits,
  comingSoon = false,
  popular = false,
  ctaTo,
  ctaHref,
  ctaLabel,
  ctaBusy = false,
  onCtaClick,
}: PricingCardProps) {
  return (
    <Card className="relative h-full min-h-92 gap-0 rounded-2xl py-0">
      {(comingSoon || popular) && (
        <Badge
          variant={popular ? "default" : "outline"}
          className="absolute top-3 right-3"
        >
          {popular ? "Recommended" : "Coming Soon"}
        </Badge>
      )}

      <CardHeader className="p-6 pb-0">
        <div className="mb-4">
          <h3 className="mb-0.5 text-2xl font-bold text-foreground">{name}</h3>
          <div className="flex items-baseline gap-1.5 mb-1.5">
            <span className="text-lg font-bold text-foreground/60">
              {price ?? "Free"}
            </span>
            {period && <span className="text-xs text-muted-foreground">{period}</span>}
          </div>
          {description && (
            <p className="text-xs text-muted-foreground">{description}</p>
          )}
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col px-6 pb-4">
        {inherits ? (
          <p className="mb-2 text-xs text-muted-foreground">
            Everything in {inherits}, plus:
          </p>
        ) : (
          <p className="mb-2 text-xs text-muted-foreground">Includes</p>
        )}

        <ul className="mb-4 flex flex-1 flex-col gap-2">
          {features.map((feature) => (
            <li
              key={feature}
              className="flex items-start gap-2.5 text-sm text-muted-foreground"
            >
              <CheckIcon />
              {feature}
            </li>
          ))}
        </ul>
      </CardContent>

      <CardFooter className="px-6 pb-6">
        {onCtaClick ? (
          <Button
            type="button"
            onClick={onCtaClick}
            disabled={ctaBusy}
            className="h-auto w-full rounded-xl px-6 py-2.5 shadow-lg disabled:cursor-wait"
          >
            {ctaBusy ? "Opening checkout…" : ctaLabel}
          </Button>
        ) : ctaHref ? (
          <Button
            asChild
            className="h-auto w-full rounded-xl px-6 py-2.5 shadow-lg"
          >
            <a href={ctaHref} target="_blank" rel="noopener noreferrer">
              {ctaLabel}
            </a>
          </Button>
        ) : ctaTo ? (
          <Button
            asChild
            className="h-auto w-full rounded-xl px-6 py-2.5 shadow-lg"
          >
            <NavLink to={ctaTo}>{ctaLabel}</NavLink>
          </Button>
        ) : (
          <Button
            variant="secondary"
            disabled
            className="h-auto w-full rounded-xl px-6 py-2.5"
          >
            Coming soon
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
