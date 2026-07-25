import { useState } from "react";

import { PublicPage } from "@/components/marketing";
import PricingFaq from "./components/PricingFaq";
import PricingHeader from "./components/PricingHeader";
import type { PricingInterval } from "./data";
import PlanGrid from "./sections/PlanGrid";
import { useProCheckout } from "./useProCheckout";

export default function Pricing() {
  const [interval, setInterval] = useState<PricingInterval>("month");
  const { openCheckout, pending, error } = useProCheckout(setInterval);

  return (
    <PublicPage>
      <PricingHeader />

      <PlanGrid
        interval={interval}
        checkoutPending={pending}
        checkoutError={error}
        onIntervalChange={setInterval}
        onProCheckout={() => void openCheckout(interval)}
      />

      <div className="mx-auto max-w-3xl border-t border-border pt-12">
        <PricingFaq />
      </div>
    </PublicPage>
  );
}
