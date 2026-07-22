import { useState } from "react";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { BETA_ACCESS_HREF } from "@/lib/site";
import PricingCard from "./PricingCard";
import PricingQA from "./PricingFooter";
import PricingHeader from "./PricingHeader";
import { plans, type PricingInterval } from "./data";

export default function Pricing() {
  const [interval, setInterval] = useState<PricingInterval>("month");

  return (
    <div className="mx-auto max-w-6xl px-4 pb-20 pt-28 sm:px-6 md:pt-32">
      <PricingHeader />

      <section aria-labelledby="plans-heading">
        <h2 id="plans-heading" className="sr-only">Plans</h2>
        <div className="mb-8 flex justify-center">
          <ToggleGroup
            type="single"
            value={interval}
            onValueChange={(value) => {
              if (value) setInterval(value as PricingInterval);
            }}
            variant="default"
            spacing={1}
            className="rounded-lg bg-muted p-1"
            aria-label="Billing interval"
          >
            <ToggleGroupItem
              value="month"
              className="h-9 rounded-md px-4 text-foreground/75 data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm"
            >
              Monthly
            </ToggleGroupItem>
            <ToggleGroupItem
              value="year"
              className="h-9 rounded-md px-4 text-foreground/75 data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm"
            >
              Yearly
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        <div className="mb-20 grid grid-cols-1 items-stretch gap-4 md:grid-cols-3">
          {plans.map((plan) => (
            <PricingCard
              key={plan.id}
              name={plan.name}
              price={plan.prices[interval].price}
              period={plan.prices[interval].period}
              description={plan.description}
              features={plan.features}
              ctaHref={BETA_ACCESS_HREF}
              ctaLabel="Join the beta"
              popular={plan.id === "pro"}
            />
          ))}
        </div>
      </section>

      <div className="mx-auto max-w-3xl border-t border-border pt-12">
        <PricingQA />
      </div>
    </div>
  );
}
