export type CustomerPlanId = keyof typeof PRICING_MODEL;
export type PaidTier = "pro";
export type BillingInterval = "month" | "year";
export type PricingInterval = BillingInterval;

/**
 * Single source of truth for plan limits and the phrasing used to describe
 * them. Everything below — the cards, the comparison table, the FAQ, and the
 * account settings upgrade prompt — reads from here so the numbers and wording
 * can never drift apart.
 */
export const PRICING_MODEL = {
  free: {
    id: "free",
    name: "Free",
    monthlyPrice: "$0",
    yearlyPrice: "$0",
    spaces: "3 Spaces",
    collaborators: "5 collaborators per Space",
    customAgents: "1 custom agent",
    storage: "2 GB",
    agentUsage: "Weekly agent usage",
    modelRouting: "Same automatic model routing as Pro",
  },
  pro: {
    id: "pro",
    name: "Pro",
    monthlyPrice: "$9",
    yearlyPrice: "$89",
    spaces: "Unlimited Spaces",
    collaborators: "Unlimited collaborators",
    customAgents: "Unlimited custom agents",
    storage: "50 GB",
    agentUsage: "over 10× more weekly agent usage",
    modelRouting: "Same automatic model routing as Free",
    trialDays: 14,
  },
} as const;

export const plans = [
  {
    id: "free",
    name: PRICING_MODEL.free.name,
    prices: {
      month: {
        price: PRICING_MODEL.free.monthlyPrice,
        period: "/ month",
        billingNote: "Free forever",
      },
      year: {
        price: PRICING_MODEL.free.yearlyPrice,
        period: "/ year",
        billingNote: "Free forever",
      },
    },
    features: [
      PRICING_MODEL.free.spaces,
      PRICING_MODEL.free.collaborators,
      PRICING_MODEL.free.customAgents,
      `${PRICING_MODEL.free.storage} total storage across Spaces you own`,
      PRICING_MODEL.free.agentUsage,
      PRICING_MODEL.free.modelRouting,
    ],
  },
  {
    id: "pro",
    name: PRICING_MODEL.pro.name,
    prices: {
      month: {
        price: PRICING_MODEL.pro.monthlyPrice,
        period: "/ month",
        billingNote: "14-day trial, then billed monthly.",
      },
      year: {
        price: PRICING_MODEL.pro.yearlyPrice,
        period: "/ year",
        billingNote: "14-day trial, then billed yearly.",
      },
    },
    features: [
      PRICING_MODEL.pro.spaces,
      PRICING_MODEL.pro.collaborators,
      PRICING_MODEL.pro.customAgents,
      `${PRICING_MODEL.pro.storage} total storage across Spaces you own`,
      PRICING_MODEL.pro.agentUsage,
      PRICING_MODEL.pro.modelRouting,
    ],
  },
] as const;

export const planLimitRows = [
  {
    label: "Price",
    free: PRICING_MODEL.free.monthlyPrice,
    pro: `${PRICING_MODEL.pro.monthlyPrice} monthly / ${PRICING_MODEL.pro.yearlyPrice} yearly`,
  },
  { label: "Spaces you own", free: "3", pro: "Unlimited" },
  { label: "Collaborators per Space", free: "5", pro: "Unlimited" },
  { label: "Custom agents", free: "1", pro: "Unlimited" },
  {
    label: "Storage pooled across owned Spaces",
    free: PRICING_MODEL.free.storage,
    pro: PRICING_MODEL.pro.storage,
  },
  {
    label: "Agent usage",
    free: "Weekly usage",
    pro: PRICING_MODEL.pro.agentUsage,
  },
  { label: "Automatic model routing", free: "Included", pro: "Included" },
] as const;

export const ownerRules = [
  {
    title: "Storage follows the owner",
    description:
      "Hosted files count toward the Space owner’s pooled storage, including files uploaded by collaborators.",
  },
  {
    title: "Collaboration does not use your storage",
    description:
      "Joining Spaces and collaborating do not use your storage. Only hosted files in Spaces you own count toward your pool.",
  },
  {
    title: "Agent usage stays personal",
    description:
      "Agent usage resets weekly. Misty shows the percentage used and reset date, never a dollar or usage-unit balance.",
  },
  {
    title: "No surprise charges",
    description:
      "There are no automatic overages or surprise charges. Usage pauses at the limit instead of creating a bill.",
  },
] as const;

export const pricingFaqs = [
  {
    q: "How does storage work across Spaces?",
    a: "Your storage is pooled across every Space you own. Hosted files are charged to the Space owner, including files uploaded by collaborators. Joining someone else’s Space and collaborating there do not use your storage.",
  },
  {
    q: "What happens when I reach my weekly agent limit?",
    a: "New agent work pauses until your weekly reset or until you upgrade. Files, Spaces, conversations, and collaboration keep working, and there are no automatic overages.",
  },
  {
    q: "Does Pro start with a trial?",
    a: "Yes. Monthly and yearly Pro subscriptions begin with a one-time 14-day trial. A card is required, and the plan automatically renews unless you cancel.",
  },
  {
    q: "Do Free and Pro use different AI models?",
    a: "No. Both plans use the same automatic model routing. Pro simply gives you over 10× more weekly agent usage.",
  },
  {
    q: "How does Misty handle my data?",
    a: "Private files stay local or with the connected provider until copied into a Space. Agents only use context you are permitted to access. If you exceed storage, existing data remains intact and nothing is automatically deleted.",
  },
  {
    q: "Can usage create an extra bill?",
    a: "No. Misty never charges beyond your plan automatically. Agent usage and new hosted uploads pause at their limits, so there are no automatic overages or surprise charges.",
  },
] as const;
