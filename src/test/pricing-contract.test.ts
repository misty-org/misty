import { describe, expect, it } from "vitest";

import { marketingCopy } from "@/content/marketingCopy";
import { PRICING_MODEL } from "@/lib/pricing";
import {
  ownerRules,
  planLimitRows,
  plans,
  pricingFaqs,
} from "@/pages/Pricing/data";

describe("pricing contract", () => {
  it("publishes only Free and Pro with the shared plan rules", () => {
    expect(plans.map((plan) => plan.id)).toEqual(["free", "pro"]);
    for (const plan of plans) {
      expect(plan.features).toContain("Unlimited Spaces");
      expect(plan.features).toContain("Unlimited collaborators");
      expect(plan.features).toContain("Unlimited custom agents");
    }
    expect(plans[0].features).toContain(
      "2 GB total storage across Spaces you own",
    );
    expect(plans[0].features).toContain("Weekly Hosted AI usage");
    expect(plans[0].features).toContain("Same automatic model routing as Pro");
    expect(plans[1].features).toContain(
      "50 GB total storage across Spaces you own",
    );
    expect(plans[1].features).toContain("over 6× more Hosted AI capacity");
    expect(plans[1].features).toContain("One-time 14-day trial");
    expect(plans[1].features).toContain("Same automatic model routing as Free");
    expect(plans[1].features).toContain("Card required · automatically renews");
    expect(plans[1].prices).toEqual({
      month: { price: "$9", period: "per month" },
      year: { price: "$89", period: "per year · save $19" },
    });
    expect(PRICING_MODEL.pro.hostedAI).toBe("over 6× more Hosted AI capacity");
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
