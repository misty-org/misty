import { useState } from "react";
import { useSearchParams } from "react-router";

import { PublicPage } from "@/components/marketing";
import CheckoutSuccess from "./components/CheckoutSuccess";
import PricingFaq from "./components/PricingFaq";
import PricingHeader from "./components/PricingHeader";
import type { PricingInterval } from "./data";
import PlanGrid from "./sections/PlanGrid";
import { usePaidCheckout } from "./useProCheckout";

export default function Pricing() {
  const [interval, setInterval] = useState<PricingInterval>("month");
  const [searchParams] = useSearchParams();
  const {
    openCheckout,
    pendingTier,
    error,
    currentPlanTier,
    hasManagedSubscription,
    trialEligible,
    checkoutReady,
  } = usePaidCheckout(setInterval);

  if (searchParams.get("checkout") === "success") {
    return <CheckoutSuccess />;
  }

  return (
    <PublicPage>
      <PricingHeader />

      <PlanGrid
        interval={interval}
        checkoutPendingTier={pendingTier}
        checkoutError={error}
        checkoutReady={checkoutReady}
        currentPlanTier={currentPlanTier}
        hasManagedSubscription={hasManagedSubscription}
        trialEligible={trialEligible}
        onIntervalChange={setInterval}
        onPaidCheckout={(tier) => void openCheckout(tier, interval)}
      />

      <div className="mx-auto max-w-3xl border-t border-border pt-12">
        <PricingFaq />
      </div>
    </PublicPage>
  );
}
