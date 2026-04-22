import { NavLink } from "react-router";
import { GlowCard } from "../../components/GlowCard";

const CheckIcon = ({ muted }: { muted?: boolean }) => (
  <svg
    className={`w-4 h-4 shrink-0 mt-0.5 ${muted ? "text-text-muted/50" : "text-primary"}`}
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
}: PricingCardProps) {
  return (
    <GlowCard className="h-full min-h-92">
      <div className="p-6 flex flex-col h-full relative">
        {(comingSoon || popular) && (
          <div className="absolute top-3 right-3">
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium border ${
              popular
                ? "bg-primary text-bg border-primary"
                : "bg-primary/10 text-primary border-primary/20"
            }`}>
              {popular ? "Most Popular" : "Coming Soon"}
            </span>
          </div>
        )}

        <div className="mb-4">
          <h3 className="text-2xl font-bold text-text mb-0.5">{name}</h3>
          <div className="flex items-baseline gap-1.5 mb-1.5">
            <span className="text-lg font-bold text-text/60">{price ?? "Free"}</span>
            {period && <span className="text-text-muted text-xs">{period}</span>}
          </div>
          {description && <p className="text-xs text-text-muted">{description}</p>}
        </div>

        {inherits ? (
          <h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-2">
            Everything in {inherits}
          </h2>
        ) : (
          <h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-2">
            Includes
          </h2>
        )}

        <ul className="flex-1 flex flex-col gap-2 mb-4">
          {features.map((feature) => (
            <li key={feature} className="flex items-start gap-2.5 text-sm text-text-muted">
              <CheckIcon />
              {feature}
            </li>
          ))}
        </ul>

        {ctaHref ? (
          <a
            href={ctaHref}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full text-center px-6 py-2.5 bg-white hover:bg-zinc-200 text-black font-medium rounded-xl transition-colors duration-300 shadow-lg"
          >
            {ctaLabel}
          </a>
        ) : ctaTo ? (
          <NavLink
            to={ctaTo}
            className="w-full text-center px-6 py-2.5 bg-white hover:bg-zinc-200 text-black font-medium rounded-xl transition-colors duration-300 shadow-lg"
          >
            {ctaLabel}
          </NavLink>
        ) : (
          <span className="w-full text-center px-6 py-2.5 bg-elevated text-text-muted font-medium rounded-xl border border-border cursor-default">
            Coming soon
          </span>
        )}
      </div>
    </GlowCard>
  );
}
