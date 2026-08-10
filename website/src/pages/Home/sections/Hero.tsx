import { NavLink } from "react-router";

import { Button } from "@/components/ui/button";
import type { MarketingCopy } from "@/content/marketingCopy";

export function Hero({ copy }: { copy: MarketingCopy["home"] }) {
  const [descriptionStart = "", descriptionEnd = ""] =
    copy.heroDescription.split(copy.heroDescriptionEmphasis);

  return (
    <section className="relative min-h-[100svh] overflow-hidden mt-20">
      <div className="relative z-10 mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-12">
        <h1 className="hero-animate hero-animate-delay-1 max-w-2xl text-[clamp(2rem,4.5vw,3.25rem)] font-semibold leading-[1.1] tracking-[-0.03em] text-[var(--marketing-foreground)]">
          {copy.heroTitle}
        </h1>

        {/* Subtitle */}
        <p className="hero-animate hero-animate-delay-3 mt-6 max-w-3xl text-lg font-normal leading-[1.35] tracking-[-0.03em] text-[var(--marketing-muted)]">
          {descriptionStart}
          {copy.heroDescriptionEmphasis}
          {descriptionEnd}
        </p>

        {/* CTAs */}
        <div className="hero-animate hero-animate-delay-4 mt-8 flex flex-wrap items-center gap-3">
          <Button asChild size="lg" className="h-10 rounded-md bg-[var(--marketing-foreground)] px-5 text-sm text-[var(--marketing-surface)] hover:opacity-85">
            <NavLink to="/register">Get started</NavLink>
          </Button>
          <Button
            asChild
            variant="outline"
            size="lg"
            className="h-10 rounded-md border-[var(--marketing-border)] bg-transparent px-5 text-sm text-[var(--marketing-foreground)] hover:bg-[var(--secondary)]"
          >
            <NavLink to="/features">Try it out</NavLink>
          </Button>
        </div>

        {/* Product screenshot — app-native framing */}
        <div className="hero-animate hero-animate-delay-5 relative mt-16 sm:mt-20">
          <div className="overflow-hidden rounded-xl border border-[var(--marketing-border)] bg-[var(--marketing-surface)] shadow-2xl shadow-black/15 dark:shadow-black/40">
            {/* Window chrome matching the app's titlebar */}
            <div className="flex items-center gap-1.5 border-b border-[var(--marketing-border)] px-4 py-2.5">
              <span className="size-[10px] rounded-full bg-[var(--marketing-border-strong)]" />
              <span className="size-[10px] rounded-full bg-[var(--marketing-border-strong)]" />
              <span className="size-[10px] rounded-full bg-[var(--marketing-border-strong)]" />
              <span className="ml-3 text-[11px] font-medium text-[var(--marketing-muted)]">
                Space Library
              </span>
            </div>
            <img
              src="/space-library-crop.webp"
              alt="Misty Space Library with shared research and files"
              className="w-full object-cover object-top"
              width="1600"
              height="1000"
              loading="eager"
              fetchPriority="high"
              decoding="async"
            />
          </div>
        </div>
      </div>

      {/* Bottom fade */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-background to-transparent"
      />
    </section>
  );
}
