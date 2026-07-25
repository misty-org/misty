import { NavLink } from "react-router";

import { publicPageContainer } from "@/components/marketing";
import { ProductScreenshot } from "@/components/marketing/previews";
import { Button } from "@/components/ui/button";
import type { MarketingCopy } from "@/content/marketingCopy";
import { HeroHeadline } from "../components/HeroHeadline";

export function Hero({ copy }: { copy: MarketingCopy["home"] }) {
  return (
    <section className="border-b border-border py-16 sm:py-20 lg:py-24">
      <div className={publicPageContainer}>
        <div className="max-w-5xl">
          <HeroHeadline heroTitle={copy.heroTitle} />
          <p className="mt-7 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg">
            {copy.heroDescription}
          </p>
          <div className="mt-9">
            <Button asChild size="lg" className="px-5">
              <NavLink to="/register">Get started</NavLink>
            </Button>
          </div>
        </div>

        <div className="mt-14 sm:mt-16">
          <ProductScreenshot
            src="/space-library-crop.webp"
            alt="Misty Space Library with shared research and files"
            label="Space Library · Beta"
            eager
          />
        </div>
      </div>
    </section>
  );
}
