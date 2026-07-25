import IntervalToggle from "../components/IntervalToggle";
import PricingCard from "../components/PricingCard";
import { plans, type PricingInterval } from "../data";
import { planFeatureList } from "../planFeatures";

export default function PlanGrid({
  interval,
  checkoutPending,
  checkoutError,
  onIntervalChange,
  onProCheckout,
}: {
  interval: PricingInterval;
  checkoutPending: boolean;
  checkoutError: string;
  onIntervalChange: (interval: PricingInterval) => void;
  onProCheckout: () => void;
}) {
  return (
    <section aria-labelledby="plans-heading" className="pt-10 sm:pt-12">
      <h2 id="plans-heading" className="sr-only">
        Plans
      </h2>
      <IntervalToggle interval={interval} onChange={onIntervalChange} />

      <div className="mx-auto mb-20 grid max-w-3xl grid-cols-1 items-stretch gap-5 pt-3 md:grid-cols-2">
        {plans.map((plan, index) => {
          const { inheritsFrom, features } = planFeatureList(index);
          return (
            <PricingCard
              key={plan.id}
              name={plan.name}
              price={plan.prices[interval].price}
              period={plan.prices[interval].period}
              billingNote={plan.prices[interval].billingNote}
              features={features}
              inheritsFrom={inheritsFrom}
              ctaHref={plan.id === "free" ? "/signin" : undefined}
              ctaLabel={plan.id === "free" ? "Join now" : "Start 14-day trial"}
              ctaBusy={plan.id === "pro" && checkoutPending}
              onCtaClick={plan.id === "pro" ? onProCheckout : undefined}
              popular={plan.id === "pro"}
            />
          );
        })}
      </div>
      {checkoutError ? (
        <p
          role="alert"
          className="mx-auto -mt-16 mb-16 max-w-3xl text-sm text-destructive"
        >
          {checkoutError}
        </p>
      ) : null}
    </section>
  );
}
