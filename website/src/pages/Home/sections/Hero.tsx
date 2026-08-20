import { NavLink } from "react-router";

import { MistyAppMockup } from "@/components/marketing/appchrome";
import { Button } from "@/components/ui/button";
import type { MarketingCopy } from "@/content/marketingCopy";
import { easeOut, useScrollProgress } from "@/hooks/useScrollProgress";

/** How small the window starts before scroll grows it to full width. */
const START_SCALE = 0.8;

export function Hero({ copy }: { copy: MarketingCopy["home"] }) {
  const { ref, progress } = useScrollProgress<HTMLDivElement>();
  const scale = START_SCALE + (1 - START_SCALE) * easeOut(progress);

  return (
    <section className="relative pt-10 sm:pt-16">
      <div className="relative z-10 mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-12">
        <p className="hero-animate inline-flex items-center gap-2 rounded-full border border-[var(--marketing-border-strong)] px-3 py-1 text-[13px] text-[var(--marketing-muted)]">
          <span className="size-1.5 rounded-full bg-[var(--marketing-foreground)]" />
          {copy.eyebrow}
        </p>

        {/*
          Two-tone headline: the claim in full contrast, the qualifier in
          muted. It reads as one sentence but gives the eye a single place to
          land, which is what keeps a long product name from feeling long.
        */}
        <h1 className="hero-animate hero-animate-delay-1 mt-7 max-w-3xl text-[clamp(2.25rem,5.2vw,3.75rem)] font-semibold leading-[1.05] tracking-[-0.035em] text-[var(--marketing-foreground)]">
          {copy.heroTitleLead}
          <br />
          <span className="text-[var(--marketing-muted)]">
            {copy.heroTitleTrail}
          </span>
        </h1>

        <p className="hero-animate hero-animate-delay-3 mt-6 max-w-xl text-lg leading-[1.45] tracking-[-0.015em] text-[var(--marketing-muted)]">
          {copy.heroDescription}
        </p>

        <div className="hero-animate hero-animate-delay-4 mt-8 flex flex-wrap items-center gap-3">
          <Button
            asChild
            size="lg"
            className="h-11 rounded-full bg-[var(--marketing-foreground)] px-6 text-sm text-[var(--marketing-surface)] hover:opacity-85"
          >
            <NavLink to="/register">Get started</NavLink>
          </Button>
          <Button
            asChild
            variant="outline"
            size="lg"
            className="h-11 rounded-full border-[var(--marketing-border-strong)] bg-transparent px-6 text-sm text-[var(--marketing-foreground)] hover:bg-[var(--secondary)]"
          >
            <NavLink to="/features">See how it works</NavLink>
          </Button>
        </div>

        <p className="hero-animate hero-animate-delay-5 mt-20 text-center text-[13px] text-[var(--marketing-muted)]">
          ▶ Private files stay on your device until you add them to a Space
        </p>
      </div>

      {/*
        The window pins and grows to full width as you scroll past it, so the
        product arrives by being opened rather than by sliding into place. Two
        viewports of track: one to grow through, one to hold it at full size
        before the section releases.
      */}
      <div
        ref={ref}
        className="pin-track relative mt-5 hidden lg:block"
        style={{ height: "200svh" }}
      >
        <div className="pin-stage">
          <div className="mx-auto w-full max-w-[1440px] px-5 sm:px-8 lg:px-12">
            <div
              className="origin-center will-change-transform"
              style={{ transform: `scale(${scale})` }}
            >
              <MistyAppMockup view="space" bodyClass="h-[440px]" />
            </div>
          </div>
        </div>
      </div>

      {/* Small screens — and reduced motion at any width — get the window at
          its natural size, with no scroll dependency. */}
      <div className="pin-stacked mx-auto mt-5 max-w-[1440px] px-5 sm:px-8 lg:hidden lg:px-12">
        <MistyAppMockup view="space" bodyClass="h-[300px] sm:h-[380px]" />
      </div>
    </section>
  );
}
