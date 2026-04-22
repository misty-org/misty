import PricingHeader from "./PricingHeader";
import PricingCard from "./PricingCard";
import PricingQA from "./PricingFooter";
import { liteFeatures, proFeatures, maxFeatures } from "./data";
import { useAuth } from "../../AuthContext";

export default function Pricing() {
  const { user } = useAuth();

  function buildStripeLink(link?: string) {
    if (!link || !user?.email) return undefined;
    const url = new URL(link);
    url.searchParams.set("locked_prefilled_email", user.email);
    url.searchParams.set("client_reference_id", user.id);
    return url.toString();
  }

  return (
    <div className="max-w-6xl mx-auto px-4 pt-32 pb-20">
      <PricingHeader />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-20 items-stretch">
        <PricingCard
          name="Lite"
          price="Free"
          description="Everything you need to get started."
          features={liteFeatures}
          ctaTo="/download"
          ctaLabel="Get started"
        />
        <PricingCard
          name="Pro"
          price="$30"
          period="per device"
          description="Full power on the devices you use most."
          features={proFeatures}
          ctaHref={buildStripeLink(import.meta.env.VITE_STRIPE_LINK_PRO)}
          ctaTo={user ? undefined : "/signin"}
          ctaLabel="Get Pro"
          inherits="Lite"
          popular
        />
        <PricingCard
          name="Max"
          price="$89"
          period="unlimited devices"
          description="Every device, every platform, every feature."
          features={maxFeatures}
          ctaHref={buildStripeLink(import.meta.env.VITE_STRIPE_LINK_MAX)}
          ctaTo={user ? undefined : "/signin"}
          ctaLabel="Get Max"
          inherits="Pro"
        />
      </div>

      <PricingQA />
    </div>
  );
}
