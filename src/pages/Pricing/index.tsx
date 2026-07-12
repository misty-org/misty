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
        <div className="inline-flex rounded-xl border border-border bg-surface/70 p-1" aria-label="Billing interval">
          {(["month", "year"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={interval === value}
              onClick={() => setInterval(value)}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors cursor-pointer ${
                interval === value
                  ? "bg-white text-black"
                  : "text-text-muted hover:text-text"
              }`}
            >
              {value === "month" ? "Monthly" : "Yearly · save 17%"}
            </button>
          ))}
        </div>
      </div>

      {checkoutError && (
        <p role="alert" className="mb-6 text-center text-sm text-red-400">
          {checkoutError}
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-12 items-stretch">
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

      <section className="mb-20 rounded-2xl border border-border bg-surface/40 px-6 py-7 md:flex md:items-center md:justify-between md:gap-10">
        <div className="max-w-2xl">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary">Credits where cost exists</p>
          <h2 className="mb-2 text-xl font-semibold text-text">Local work stays unlimited</h2>
          <p className="text-sm leading-6 text-text-muted">
            Credits are used only by managed AI, including Mika and AI-backed automation nodes. File operations, backups, cleanup scans, sync, scheduled workflows, and non-AI automations do not use credits.
          </p>
        </div>
        <div className="mt-6 grid shrink-0 grid-cols-2 gap-3 md:mt-0">
          {creditPacks.map((pack) => (
            <div key={pack.credits} className="rounded-xl border border-border bg-bg/50 px-4 py-3 text-center">
              <p className="font-semibold text-text">{pack.credits}</p>
              <p className="text-xs text-text-muted">credits · {pack.price}</p>
            </div>
          ))}
        </div>
      </section>

      <PricingQA />
    </div>
  );
}
