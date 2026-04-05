import PricingHeader from "./PricingHeader";
import PricingCard from "./PricingCard";
import PricingFooter from "./PricingFooter";
import { liteFeatures, proFeatures, maxFeatures } from "./data";

export default function Pricing() {
  return (
    <div className="max-w-4xl mx-auto px-4 pt-32 pb-20">
      <PricingHeader />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-20">
        <PricingCard
          name="Lite"
          price="Free"
          features={liteFeatures}
          ctaTo="/download"
          ctaLabel="Get Lite"
        />
        <PricingCard
          name="Pro"
          price="$30"
          period="/ year"
          features={proFeatures}
          ctaTo="/download"
          ctaLabel="Get Pro"
          inherits="Lite"
          popular
        />
        <PricingCard
          name="Max"
          price="$150"
          period="lifetime"
          features={maxFeatures}
          ctaTo="/download"
          ctaLabel="Get Max"
          inherits="Pro"
        />
      </div>

      <PricingFooter />
    </div>
  );
}
