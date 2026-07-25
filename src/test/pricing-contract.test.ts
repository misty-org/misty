import { describe, expect, it } from "vitest";

import { marketingCopy } from "@/content/marketingCopy";
import {
  ownerRules,
  planLimitRows,
  plans,
  pricingFaqs,
  PRICING_MODEL,
} from "@/pages/Pricing/data";

describe("pricing contract", () => {
  it("publishes only Free and Pro with the advertised plan limits", () => {
    expect(plans.map((plan) => plan.id)).toEqual(["free", "pro"]);
    expect(plans[0].features).toContain("3 Spaces");
    expect(plans[0].features).toContain("5 collaborators per Space");
    expect(plans[0].features).toContain("1 custom agent");
    expect(plans[0].features).toContain(
      "2 GB total storage across Spaces you own",
    );
    expect(plans[0].features).toContain("Weekly agent usage");
    expect(plans[0].features).toContain("Same automatic model routing as Pro");
    expect(plans[1].features).toContain("Unlimited Spaces");
    expect(plans[1].features).toContain("Unlimited collaborators");
    expect(plans[1].features).toContain("Unlimited custom agents");
    expect(plans[1].features).toContain(
      "50 GB total storage across Spaces you own",
    );
    expect(plans[1].features).toContain("over 10× more weekly agent usage");
    expect(plans[1].features).toContain("Same automatic model routing as Free");
    expect(plans[1].prices).toEqual({
      month: {
        price: "$9",
        period: "/ month",
        billingNote: "14-day trial, then billed monthly.",
      },
      year: {
        price: "$89",
        period: "/ year",
        billingNote: "14-day trial, then billed yearly.",
      },
    });
    expect(PRICING_MODEL.pro.agentUsage).toBe(
      "over 10× more weekly agent usage",
    );
  });

  // The Pro card used to carry "One-time 14-day trial" and "Card required ·
  // automatically renews" as feature bullets. Those bullets are gone, so this
  // pins the same disclosure to wherever it now lives on the pricing page.
  it("discloses the trial, card requirement, and automatic renewal", () => {
    expect(plans[1].prices.month.billingNote).toMatch(/14-day trial/i);
    expect(plans[1].prices.year.billingNote).toMatch(/14-day trial/i);

    const faq = JSON.stringify(pricingFaqs);
    expect(faq).toMatch(/card is required/i);
    expect(faq).toMatch(/automatically renews/i);
  });

  it("keeps retired terminology out of customer-facing pricing and homepage copy", () => {
    const customerCopy = JSON.stringify({
      plans,
      planLimitRows,
      ownerRules,
      pricingFaqs,
      home: marketingCopy.home,
      pricing: marketingCopy.pricing,
      metadata: {
        home: marketingCopy.metadata.home,
        pricing: marketingCopy.metadata.pricing,
      },
    });
    expect(customerCopy).not.toMatch(/\b(?:max|mika|credits?)\b/i);
    expect(customerCopy).not.toMatch(
      /(?:paid overages|automatic refills|model-quality paywalls?)/i,
    );
  });

  it("makes storage ownership and billing safety explicit", () => {
    const customerCopy = JSON.stringify({ ownerRules, pricingFaqs });
    expect(customerCopy).toMatch(/pooled across every Space you own/i);
    expect(customerCopy).toMatch(/joining .*Spaces.*do not use your storage/i);
    expect(customerCopy).toMatch(/nothing is automatically deleted/i);
    expect(customerCopy).toMatch(/no automatic overages/i);
  });
});
