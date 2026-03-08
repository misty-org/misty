import PricingHeader from "./PricingHeader";
import PricingCard from "./PricingCard";
import PricingFooter from "./PricingFooter";
import { liteFeatures, proFeatures } from "./data";

export default function Pricing() {
  return (
    <div className="max-w-6xl mx-auto px-6 py-20">
      <PricingHeader />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-3xl mx-auto mb-20">
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
          period="one-time"
          features={proFeatures}
          ctaTo="/download"
          ctaLabel="Get Pro"
          inherits="Lite"
        />
      </div>

      <PricingFooter />
    </div>
  );
}
