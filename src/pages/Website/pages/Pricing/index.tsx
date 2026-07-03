import PricingHeader from "./PricingHeader";
import PricingCard from "./PricingCard";
import PricingQA from "./PricingFooter";
import { freeFeatures, personalFeatures, unlimitedFeatures } from "./data";
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
    <div className="max-w-7xl mx-auto px-3 sm:px-4 pt-32 pb-20">
      <PricingHeader />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-20 items-stretch">
        <PricingCard
          name="Free"
          price="Free"
          description="A lightweight starting point for one provider."
          features={freeFeatures}
          ctaTo="/download"
          ctaLabel="Download Free"
        />
        <PricingCard
          name="Personal"
          price="$25"
          period="up to 5 devices"
          description="A generous paid plan for one person across the devices they actually use."
          features={personalFeatures}
          ctaTo={user ? "/download" : "/signin"}
          ctaLabel="Start 14-day Free Trial"
          popular
        />
        <PricingCard
          name="Unlimited"
          price="$89"
          period="unlimited devices"
          description="No limits, premium support, and faster bug-fix updates as your setup grows."
          features={unlimitedFeatures}
          ctaHref={buildStripeLink(import.meta.env.VITE_STRIPE_LINK_UNLIMITED ?? import.meta.env.VITE_STRIPE_LINK_MAX)}
          ctaTo={user ? undefined : "/signin"}
          ctaLabel="Get Unlimited"
        />
      </div>

      <PricingQA />
    </div>
  );
}
