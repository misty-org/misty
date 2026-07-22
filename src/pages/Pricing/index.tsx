import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { useAuth } from "@/AuthContext";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PublicPage } from "@/components/marketing/PublicPage";
import PricingCard from "./PricingCard";
import PricingQA from "./PricingFooter";
import PricingHeader from "./PricingHeader";
import { createSubscriptionCheckout } from "./api";
import { ownerRules, planLimitRows, plans, type PricingInterval } from "./data";

export default function Pricing() {
  const [interval, setInterval] = useState<PricingInterval>("month");
  const [checkoutPending, setCheckoutPending] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  const checkoutAttempt = useRef("");
  const navigate = useNavigate();
  const { user } = useAuth();

  const openProCheckout = useCallback(
    async (selectedInterval: PricingInterval) => {
      if (!user) {
        navigate("/signin", {
          state: {
            from: `/pricing?checkout=pro&interval=${selectedInterval}`,
          },
        });
        return;
      }

      setCheckoutPending(true);
      setCheckoutError("");
      try {
        const url = await createSubscriptionCheckout("pro", selectedInterval);
        window.location.assign(url);
      } catch (error) {
        setCheckoutError(
          error instanceof Error ? error.message : "Unable to start checkout",
        );
        setCheckoutPending(false);
      }
    },
    [navigate, user],
  );

  useEffect(() => {
    if (!user || searchParams.get("checkout") !== "pro") return;
    const selectedInterval =
      searchParams.get("interval") === "year" ? "year" : "month";
    const attemptKey = `${user.id}:${selectedInterval}`;
    if (checkoutAttempt.current === attemptKey) return;
    checkoutAttempt.current = attemptKey;
    setInterval(selectedInterval);
    setSearchParams({}, { replace: true });
    void openProCheckout(selectedInterval);
  }, [openProCheckout, searchParams, setSearchParams, user]);

  return (
    <PublicPage>
      <PricingHeader />

      <section aria-labelledby="plans-heading" className="pt-12 sm:pt-16">
        <h2 id="plans-heading" className="sr-only">
          Plans
        </h2>
        <div className="mb-8 flex justify-start">
          <ToggleGroup
            type="single"
            value={interval}
            onValueChange={(value) => {
              if (value) setInterval(value as PricingInterval);
            }}
            variant="default"
            spacing={1}
            className="rounded-lg border border-border bg-muted/40 p-1"
            aria-label="Billing interval"
          >
            <ToggleGroupItem
              value="month"
              className="h-9 rounded-md px-4 text-foreground/75 data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-xs"
            >
              Monthly
            </ToggleGroupItem>
            <ToggleGroupItem
              value="year"
              className="h-9 rounded-md px-4 text-foreground/75 data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-xs"
            >
              Yearly
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        <div className="mb-20 grid grid-cols-1 items-stretch gap-4 md:max-w-4xl md:grid-cols-2">
          {plans.map((plan) => (
            <PricingCard
              key={plan.id}
              name={plan.name}
              price={plan.prices[interval].price}
              period={plan.prices[interval].period}
              description={plan.description}
              features={plan.features}
              ctaHref={plan.id === "free" ? "/register" : undefined}
              ctaLabel={
                plan.id === "free" ? "Start Free" : "Start 14-day trial"
              }
              ctaBusy={plan.id === "pro" && checkoutPending}
              onCtaClick={
                plan.id === "pro"
                  ? () => void openProCheckout(interval)
                  : undefined
              }
              popular={plan.id === "pro"}
            />
          ))}
        </div>
        {checkoutError ? (
          <p role="alert" className="-mt-12 mb-16 text-sm text-destructive">
            {checkoutError}
          </p>
        ) : null}
      </section>

      <section
        aria-labelledby="comparison-heading"
        className="mb-20 border-t border-border pt-12"
      >
        <h2
          id="comparison-heading"
          className="text-2xl font-medium tracking-[-0.03em] text-foreground"
        >
          What each plan includes
        </h2>
        <div
          className="mt-7 overflow-x-auto rounded-xl ring-1 ring-foreground/10"
          role="region"
          aria-label="Plan comparison"
          tabIndex={0}
        >
          <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
            <thead className="bg-muted/45 text-foreground">
              <tr>
                <th scope="col" className="px-5 py-4 font-medium">
                  Plan detail
                </th>
                <th scope="col" className="px-5 py-4 font-medium">
                  Free
                </th>
                <th scope="col" className="px-5 py-4 font-medium">
                  Pro
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {planLimitRows.map((row) => (
                <tr key={row.label}>
                  <th
                    scope="row"
                    className="px-5 py-4 font-normal text-muted-foreground"
                  >
                    {row.label}
                  </th>
                  <td className="px-5 py-4 text-foreground">{row.free}</td>
                  <td className="px-5 py-4 text-foreground">{row.pro}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section
        aria-labelledby="ownership-heading"
        className="mb-20 border-t border-border pt-12"
      >
        <h2
          id="ownership-heading"
          className="text-2xl font-medium tracking-[-0.03em] text-foreground"
        >
          Built for shared ownership
        </h2>
        <div className="mt-7 grid gap-x-10 gap-y-8 md:grid-cols-2">
          {ownerRules.map((rule) => (
            <article key={rule.title} className="border-t border-border pt-5">
              <h3 className="font-medium text-foreground">{rule.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {rule.description}
              </p>
            </article>
          ))}
        </div>
      </section>

      <div className="max-w-3xl border-t border-border pt-12">
        <PricingQA />
      </div>
    </PublicPage>
  );
}
