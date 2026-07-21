import { useState } from "react";
import PricingHeader from "./PricingHeader";
import PricingCard from "./PricingCard";
import PricingQA from "./PricingFooter";
import {
  ownerRules,
  permanentCreditPacks,
  planLimitRows,
  plans,
  subscriberRefills,
  type PricingInterval,
} from "./data";
import { BETA_ACCESS_HREF } from "@/lib/site";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export default function Pricing() {
  const [interval, setInterval] = useState<PricingInterval>("month");

  return (
    <div className="mx-auto max-w-6xl px-4 pb-20 pt-28 sm:px-6 md:pt-32">
      <PricingHeader />

      <section aria-labelledby="plans-heading">
        <h2 id="plans-heading" className="sr-only">Plans</h2>
        <div className="mb-8 flex flex-col items-center gap-3">
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
          {(["month", "year"] as const).map((value) => (
            <ToggleGroupItem
              key={value}
              value={value}
              className="h-9 rounded-md px-4 text-foreground/75 data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm"
            >
              {value === "month" ? "Monthly" : "Yearly · save up to 18%"}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <p className="text-center text-xs text-muted-foreground">
          Pricing is planned. Checkout is closed.
        </p>
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

      <section aria-labelledby="limits-heading" className="mb-20 scroll-mt-24">
        <div className="mb-6 max-w-2xl">
          <h2 id="limits-heading" className="mb-2 text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
            Plan limits
          </h2>
          <p className="text-sm leading-6 text-muted-foreground">
            Space limits come from the owner. Mika credits belong to each member.
          </p>
        </div>

        <Card className="rounded-2xl py-0">
          <CardContent className="p-0">
            <div
              className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              role="region"
              aria-label="Plan limits comparison"
              tabIndex={0}
            >
              <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                <caption className="sr-only">Free, Pro, and Max plan limits</caption>
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th scope="col" className="px-5 py-4 font-medium text-muted-foreground">Limit</th>
                    <th scope="col" className="px-5 py-4 font-semibold text-foreground">Free</th>
                    <th scope="col" className="px-5 py-4 font-semibold text-foreground">Pro</th>
                    <th scope="col" className="px-5 py-4 font-semibold text-foreground">Max</th>
                  </tr>
                </thead>
                <tbody>
                  {planLimitRows.map((row) => (
                    <tr key={row.label} className="border-b border-border/70 last:border-b-0">
                      <th scope="row" className="px-5 py-4 font-medium text-foreground">{row.label}</th>
                      <td className="px-5 py-4 text-muted-foreground">{row.free}</td>
                      <td className="px-5 py-4 text-muted-foreground">{row.pro}</td>
                      <td className="px-5 py-4 text-muted-foreground">{row.max}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="rules-heading" className="mb-20">
        <div className="mb-6 max-w-2xl">
          <h2 id="rules-heading" className="mb-2 text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
            Owner and member rules
          </h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {ownerRules.map((rule) => (
            <Card key={rule.title} size="sm" className="rounded-2xl bg-card/70">
              <CardContent>
                <h3 className="mb-2 font-semibold text-foreground">{rule.title}</h3>
                <p className="text-sm leading-6 text-muted-foreground">{rule.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section aria-labelledby="credits-heading" className="mb-20">
        <div className="mb-7 max-w-2xl">
          <h2 id="credits-heading" className="mb-2 text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
            Credit packs
          </h2>
          <p className="text-sm leading-6 text-muted-foreground">
            Mika pauses at zero. There are no automatic overages.
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="rounded-2xl">
            <CardContent>
              <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-semibold text-foreground">Planned one-time top-ups</h3>
                  <p className="mt-1 text-xs text-muted-foreground">Keep them on your account</p>
                </div>
                <Badge variant="outline">Do not expire</Badge>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {permanentCreditPacks.map((pack) => (
                  <div key={pack.name} className="rounded-xl border border-border bg-muted/30 p-4">
                    <p className="font-semibold text-foreground">{pack.name}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{pack.price}</p>
                    <p className="mt-3 text-xs text-muted-foreground">{pack.detail}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl">
            <CardContent>
              <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-semibold text-foreground">Planned subscriber refills</h3>
                  <p className="mt-1 text-xs text-muted-foreground">For active Pro and Max subscribers</p>
                </div>
                <Badge variant="outline">Expires at reset</Badge>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {subscriberRefills.map((refill) => (
                  <div key={refill.name} className="rounded-xl border border-border bg-muted/30 p-4">
                    <p className="text-xs font-medium text-muted-foreground">{refill.name}</p>
                    <p className="mt-1 font-semibold text-foreground">{refill.credits}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{refill.price}</p>
                    <p className="mt-3 text-xs text-muted-foreground">{refill.detail}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      <PricingQA />
    </div>
  );
}
