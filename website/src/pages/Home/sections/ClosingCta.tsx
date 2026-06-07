import { useReveal } from "@/hooks/useReveal";
import type { MarketingCopy } from "@/content/marketingCopy";
import { HomeCtaButtons } from "../components/HomeCtaButtons";

export function ClosingCta({ copy }: { copy: MarketingCopy["home"] }) {
  const ref = useReveal<HTMLElement>();

  return (
    <section
      ref={ref}
      aria-labelledby="closing-cta-title"
      className="reveal bg-[#08090a] py-20 sm:py-24"
    >
      <div className="site-container">
        <div className="mx-auto max-w-3xl text-center">
          <h2
            id="closing-cta-title"
            className="text-balance text-3xl font-semibold tracking-[-0.03em] text-white sm:text-4xl"
          >
            {copy.ctaTitle}
          </h2>
          <HomeCtaButtons className="mt-8 justify-center" dark />
        </div>
      </div>
    </section>
  );
}
