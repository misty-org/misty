import { NavLink } from "react-router";
import { GlowCard } from "../components/GlowCard";

const freeFeatures = [
  "Google Drive, OneDrive & Dropbox",
  "Up to 3 cloud accounts",
  "Automatic file syncing for all providers",
  "Basic cross-provider file operations",
  "Cross-platform (Windows, macOS, Linux)",
];

const proFeatures = [
  "Everything in Free",
  "Up to 7 cloud accounts",
  "Access to Misty clipboard for global cross-provider file operations",
  "5GB of Misty clipboard transfer data per month",
];

const maxFeatures = [
  "Everything in Pro",
  "Unlimited cloud accounts",
  "Unlimited Misty clipboard transfer data",
  "Priority support and troubleshooting",
  "Early access to new features",
];

export default function Pricing() {
  return (
    <div className="max-w-6xl mx-auto px-6 py-20">
      {/* Header */}
      <div className="text-center mb-16">
        <span className="text-xs font-medium text-primary uppercase tracking-wider">Pricing</span>
        <h1 className="text-3xl md:text-5xl font-bold text-text mt-3 mb-5 text-balance">
          Free for everyone
        </h1>
        <p className="text-text-muted max-w-lg mx-auto text-pretty leading-relaxed">
          Misty is free and open source. All core features are included at no
          cost, no credit card required.
        </p>
      </div>

      {/* Pricing cards */}
      <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto mb-20">
        {/* Free tier */}
        <GlowCard className="h-full">
          <div className="p-6 sm:p-8 flex flex-col h-full">
            <div className="mb-6">
              <h3 className="text-2xl sm:text-3xl font-semibold text-text mb-1">Basic</h3>
              <div className="flex items-baseline gap-1">
                <span className="text-xl font-bold text-text/60">Free</span>
              </div>
            </div>

            <ul className="flex-1 flex flex-col gap-3 mb-8">
              {freeFeatures.map((feature) => (
                <li key={feature} className="flex items-start gap-3 text-sm text-text-muted">
                  <svg className="w-4 h-4 text-primary shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                  {feature}
                </li>
              ))}
            </ul>

            <NavLink
              to="/download"
              className="w-full text-center px-6 py-3 bg-primary hover:bg-primary-hover text-text font-medium rounded-xl transition-all duration-300 shadow-lg shadow-primary/10 hover:shadow-primary/20 hover:-translate-y-0.5"
            >
              Get Basic
            </NavLink>
          </div>
        </GlowCard>

        {/* Pro tier (coming soon) */}
        <GlowCard className="h-full">
          <div className="p-6 sm:p-8 flex flex-col h-full relative">
            <div className="absolute top-4 right-4">
              <span className="px-3 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20">
                Coming Soon
              </span>
            </div>

            <div className="mb-6">
              <h3 className="text-2xl sm:text-3xl font-semibold text-text mb-1">Pro</h3>
              <div className="flex items-baseline gap-1">
                <span className="text-xl font-bold text-text/60">$3</span>
                <span className="text-text-muted text-sm">/mo</span>
              </div>
            </div>

            <ul className="flex-1 flex flex-col gap-3 mb-8">
              {proFeatures.map((feature) => (
                <li key={feature} className="flex items-start gap-3 text-sm text-text-muted">
                  <svg className="w-4 h-4 text-text-muted/50 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                  {feature}
                </li>
              ))}
            </ul>

            <span className="w-full text-center px-6 py-3 bg-elevated text-text-muted font-medium rounded-xl border border-border cursor-default">
              Coming soon
            </span>
          </div>
        </GlowCard>

        {/* Max tier (coming soon) */}
        <GlowCard className="h-full">
          <div className="p-6 sm:p-8 flex flex-col h-full relative">
            <div className="absolute top-4 right-4">
              <span className="px-3 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20">
                Coming Soon
              </span>
            </div>

            <div className="mb-6">
              <h3 className="text-2xl sm:text-3xl font-semibold text-text mb-1">Max</h3>
              <div className="flex items-baseline gap-1">
                <span className="text-xl font-bold text-text/60">$7</span>
                <span className="text-text-muted text-sm">/mo</span>
              </div>
            </div>

            <ul className="flex-1 flex flex-col gap-3 mb-8">
              {maxFeatures.map((feature) => (
                <li key={feature} className="flex items-start gap-3 text-sm text-text-muted">
                  <svg className="w-4 h-4 text-text-muted/50 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                  {feature}
                </li>
              ))}
            </ul>

            <span className="w-full text-center px-6 py-3 bg-elevated text-text-muted font-medium rounded-xl border border-border cursor-default">
              Coming soon
            </span>
          </div>
        </GlowCard>

      </div>

      

      {/* FAQ-like note */}
      <div className="text-center max-w-xl mx-auto">
        <p className="text-sm text-text-muted leading-relaxed">
          Misty is open source and community-driven. The free tier includes
          everything you need to manage files across cloud providers and
          devices. We may introduce a Pro tier in the future with advanced
          features, but the core experience will always be free.
        </p>
      </div>
    </div>
  );
}
