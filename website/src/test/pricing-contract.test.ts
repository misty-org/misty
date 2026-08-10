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
  it("publishes Basic, Pro, and Max with the finalized limits", () => {
    expect(plans.map((plan) => plan.id)).toEqual(["free", "pro", "max"]);
    expect(plans.map((plan) => plan.name)).toEqual(["Basic", "Pro", "Max"]);
    expect(PRICING_MODEL.free.spaces).toBe("Up to 3 Spaces");
    expect(PRICING_MODEL.pro.spaces).toBe("Up to 10 Spaces");
    expect(PRICING_MODEL.max.spaces).toBe("Unlimited Spaces");
    expect(PRICING_MODEL.max.storage).toBe("250 GB");
    expect(PRICING_MODEL.free.agentUsage).toBe("Light AI agent usage");
    expect(PRICING_MODEL.pro.agentUsage).toBe(
      "Approximately 6× Basic agent usage",
    );
    expect(PRICING_MODEL.max.agentUsage).toBe("2× Pro agent usage");
  });

  it("publishes exact monthly and annual prices and savings", () => {
    expect(plans[0].prices.month.price).toBe("Free");
    expect(plans[0].prices.year.price).toBe("Free");
    expect(plans[1].prices.month.price).toBe("$8");
    expect(plans[1].prices.year.price).toBe("$79");
    expect(plans[1].prices.year.billingNote).toBe("Save $17 per year");
    expect(plans[2].prices.month.price).toBe("$19");
    expect(plans[2].prices.year.price).toBe("$189");
    expect(plans[2].prices.year.billingNote).toBe("Save $39 per year");
  });

  it("keeps internal usage and per-seat terminology out of customer copy", () => {
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
    expect(customerCopy).not.toMatch(
      /(?:hosted ai|credits?|tokens?|micro-usd|provider costs?|per-seat)/i,
    );
  });

  it("publishes only verified storage amounts", () => {
    expect(plans[0].features).toContain("2 GB storage");
    expect(plans[1].features).toContain("50 GB storage");
    expect(plans[2].features).toContain("250 GB storage");
    expect(planLimitRows).toContainEqual({
      label: "Storage",
      basic: "2 GB",
      pro: "50 GB",
      max: "250 GB",
    });
  });

  it("explains personal Space limits and weekly AI agent usage", () => {
    const customerCopy = JSON.stringify({ ownerRules, pricingFaqs });
    expect(customerCopy).toMatch(/every Space you currently belong to/i);
    expect(customerCopy).toMatch(/pending invitations do not count/i);
    expect(customerCopy).toMatch(/leaving a Space frees a slot/i);
    expect(customerCopy).toMatch(/your own Misty plan/i);
    expect(customerCopy).toMatch(/cannot create another Space/i);
    expect(customerCopy).toMatch(/accept another invitation/i);
    expect(customerCopy).toMatch(/usage resets weekly/i);
    expect(customerCopy).toMatch(/short conversation uses less/i);
    expect(customerCopy).toMatch(/Smart Library indexing/i);
  });
});
