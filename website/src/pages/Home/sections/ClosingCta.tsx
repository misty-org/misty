import { NavLink } from "react-router";

import { useReveal } from "@/hooks/useReveal";
import { Button } from "@/components/ui/button";
import type { MarketingCopy } from "@/content/marketingCopy";

export function ClosingCta({ copy }: { copy: MarketingCopy["home"] }) {
  const ref = useReveal<HTMLElement>();

  return (
    <section ref={ref} className="reveal py-8 sm:py-10">
      <div className="mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-12">
        <div className="overflow-hidden rounded-xl border border-[#262626] bg-[#f1f1f1] px-6 py-12 sm:px-8 sm:py-14">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-[-0.03em] text-[#131313] sm:text-4xl">
              {copy.ctaTitle}
            </h2>
            <div className="mt-7">
              <Button asChild size="lg" className="h-10 rounded-md bg-[#131313] px-5 text-sm text-[#f1f1f1] hover:bg-[#262626]">
                <NavLink to="/register">Get started</NavLink>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
