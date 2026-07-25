import { publicPageContainer } from "@/components/marketing";
import type { MarketingCopy } from "@/content/marketingCopy";
import { JoinNowButton } from "../components/JoinNowButton";

export function ClosingCta({ copy }: { copy: MarketingCopy["home"] }) {
  return (
    <section className="bg-foreground py-16 text-background sm:py-20">
      <div
        className={`${publicPageContainer} grid gap-8 md:grid-cols-[1fr_auto] md:items-end`}
      >
        <div className="max-w-3xl">
          <h2 className="text-balance text-4xl font-medium leading-[1.04] tracking-[-0.045em] sm:text-5xl">
            {copy.ctaTitle}
          </h2>
          <p className="mt-5 max-w-xl text-base leading-7 text-background/65">
            {copy.ctaDescription}
          </p>
        </div>
        <JoinNowButton inverted />
      </div>
    </section>
  );
}
