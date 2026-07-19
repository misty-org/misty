import { useState } from "react";
import { useNavigate } from "react-router";
import PricingHeader from "./PricingHeader";
import PricingCard from "./PricingCard";
import PricingQA from "./PricingFooter";
import { basicFeatures, creditPacks, maxFeatures, proFeatures } from "./data";
import {
  createSubscriptionCheckout,
  type BillingInterval,
  type PaidTier,
} from "./api";
import { useAuth } from "../../AuthContext";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const prices = {
  pro: {
    month: { price: "$9.99", period: "per month" },
    year: { price: "$99", period: "per year · save $20.88" },
  },
  max: {
    month: { price: "$14.99", period: "per month" },
    year: { price: "$149", period: "per year · save $30.88" },
  },
} as const;

export default function Pricing() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [interval, setInterval] = useState<BillingInterval>("month");
  const [checkoutTier, setCheckoutTier] = useState<PaidTier | null>(null);
  const [checkoutError, setCheckoutError] = useState("");

  async function startCheckout(tier: PaidTier) {
    if (!user) {
      navigate("/signin");
      return;
    }

    setCheckoutTier(tier);
    setCheckoutError("");
    try {
      window.location.assign(await createSubscriptionCheckout(tier, interval));
    } catch (error) {
      setCheckoutError(error instanceof Error ? error.message : "Unable to start checkout");
      setCheckoutTier(null);
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-4 pt-32 pb-20">
      <PricingHeader />

      <div className="mb-8 flex justify-center">
        <ToggleGroup
          type="single"
          value={interval}
          onValueChange={(value) => {
            if (value) setInterval(value as BillingInterval);
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
              {value === "month" ? "Monthly" : "Yearly · save 17%"}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {checkoutError && (
        <Alert variant="destructive" className="mx-auto mb-6 max-w-lg">
          <AlertDescription className="text-center">{checkoutError}</AlertDescription>
        </Alert>
      )}

      <div className="mb-12 grid grid-cols-1 items-stretch gap-4 md:grid-cols-3">
        <PricingCard
          name="Basic"
          price="Free"
          description="A capable local data workspace with AI credits to explore Mika."
          features={basicFeatures}
          ctaTo="/download"
          ctaLabel="Download Misty"
        />
        <PricingCard
          name="Pro"
          price={prices.pro[interval].price}
          period={prices.pro[interval].period}
          description="The complete data-management suite for everyday work."
          features={proFeatures}
          ctaLabel={user ? "Choose Pro" : "Sign in to choose Pro"}
          ctaBusy={checkoutTier === "pro"}
          onCtaClick={() => void startCheckout("pro")}
          inherits="Basic"
          popular
        />
        <PricingCard
          name="Max"
          price={prices.max[interval].price}
          period={prices.max[interval].period}
          description="More capacity and deeper AI for individual power users."
          features={maxFeatures}
          ctaLabel={user ? "Choose Max" : "Sign in to choose Max"}
          ctaBusy={checkoutTier === "max"}
          onCtaClick={() => void startCheckout("max")}
          inherits="Pro"
        />
      </div>

      <Card
        role="region"
        aria-labelledby="credits-heading"
        className="mb-20 gap-6 rounded-2xl bg-card/70 px-6 py-7 md:flex-row md:items-center md:justify-between md:gap-10"
      >
        <div className="max-w-2xl">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
            Credits where cost exists
          </p>
          <h2 id="credits-heading" className="mb-2 text-xl font-semibold text-foreground">
            Local work stays unlimited
          </h2>
          <p className="text-sm leading-6 text-muted-foreground">
            Credits are used only by managed AI, including Mika and AI-backed automation nodes. File
            operations, backups, cleanup scans, sync, scheduled workflows, and non-AI automations do
            not use credits.
          </p>
        </div>
        <div className="mt-6 grid shrink-0 grid-cols-2 gap-3 md:mt-0">
          {creditPacks.map((pack) => (
            <Card
              key={pack.credits}
              size="sm"
              className="gap-0 rounded-xl bg-muted/40 px-4 py-3 text-center"
            >
              <p className="font-semibold text-foreground">{pack.credits}</p>
              <p className="text-xs text-muted-foreground">credits · {pack.price}</p>
            </Card>
          ))}
        </div>
      </Card>

      <PricingQA />
    </div>
  );
}
