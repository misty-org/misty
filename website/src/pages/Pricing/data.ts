export type CustomerPlanId = keyof typeof PRICING_MODEL;
export type PaidTier = "pro" | "max";
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
    name: "Basic",
    monthlyPrice: "Free",
    yearlyPrice: "Free",
    spaces: "Up to 3 Spaces",
    storage: "2 GB",
    agentUsage: "Light AI agent usage",
  },
  pro: {
    id: "pro",
    name: "Pro",
    monthlyPrice: "$8",
    yearlyPrice: "$79",
    yearlySavings: "$17",
    spaces: "Up to 10 Spaces",
    storage: "50 GB",
    agentUsage: "Approximately 6× Basic agent usage",
    trialDays: 14,
  },
  max: {
    id: "max",
    name: "Max",
    monthlyPrice: "$19",
    yearlyPrice: "$189",
    yearlySavings: "$39",
    spaces: "Unlimited Spaces",
    storage: "250 GB",
    agentUsage: "2× Pro agent usage",
  },
} as const;

export const plans = [
  {
    id: "free",
    name: PRICING_MODEL.free.name,
    prices: {
      month: {
        price: PRICING_MODEL.free.monthlyPrice,
        period: "",
        billingNote: "Free forever",
      },
      year: {
        price: PRICING_MODEL.free.yearlyPrice,
        period: "",
        billingNote: "Free forever",
      },
    },
    features: [
      PRICING_MODEL.free.spaces,
      PRICING_MODEL.free.agentUsage,
      "Agent usage resets weekly",
      `${PRICING_MODEL.free.storage} storage`,
      "Misty’s core collaboration experience",
    ],
  },
  {
    id: "pro",
    name: PRICING_MODEL.pro.name,
    prices: {
      month: {
        price: PRICING_MODEL.pro.monthlyPrice,
        period: "/ month",
        billingNote: "Billed monthly",
      },
      year: {
        price: PRICING_MODEL.pro.yearlyPrice,
        period: "/ year",
        billingNote: `Save ${PRICING_MODEL.pro.yearlySavings} per year`,
      },
    },
    features: [
      PRICING_MODEL.pro.spaces,
      PRICING_MODEL.pro.agentUsage,
      "Agent usage resets weekly",
      `${PRICING_MODEL.pro.storage} storage`,
      "Misty’s core collaboration experience",
    ],
  },
  {
    id: "max",
    name: PRICING_MODEL.max.name,
    prices: {
      month: {
        price: PRICING_MODEL.max.monthlyPrice,
        period: "/ month",
        billingNote: "Billed monthly",
      },
      year: {
        price: PRICING_MODEL.max.yearlyPrice,
        period: "/ year",
        billingNote: `Save ${PRICING_MODEL.max.yearlySavings} per year`,
      },
    },
    features: [
      PRICING_MODEL.max.spaces,
      PRICING_MODEL.max.agentUsage,
      "Agent usage resets weekly",
      `${PRICING_MODEL.max.storage} storage`,
      "Misty’s core collaboration experience",
    ],
  },
] as const;

export const planLimitRows = [
  {
    label: "Price",
    basic: PRICING_MODEL.free.monthlyPrice,
    pro: `${PRICING_MODEL.pro.monthlyPrice} monthly / ${PRICING_MODEL.pro.yearlyPrice} yearly`,
    max: `${PRICING_MODEL.max.monthlyPrice} monthly / ${PRICING_MODEL.max.yearlyPrice} yearly`,
  },
  {
    label: "Spaces you belong to",
    basic: "Up to 3",
    pro: "Up to 10",
    max: "Unlimited",
  },
  {
    label: "Agent usage",
    basic: PRICING_MODEL.free.agentUsage,
    pro: PRICING_MODEL.pro.agentUsage,
    max: PRICING_MODEL.max.agentUsage,
  },
  {
    label: "Storage",
    basic: PRICING_MODEL.free.storage,
    pro: PRICING_MODEL.pro.storage,
    max: PRICING_MODEL.max.storage,
  },
] as const;

export const ownerRules = [
  {
    title: "Your plan stays yours",
    description:
      "Your own plan controls your Space limit and AI agent usage. Joining a Space created by a Pro or Max member does not upgrade your account.",
  },
  {
    title: "Pending invitations do not count",
    description:
      "A Space counts only after you join it. Pending invitations do not use a Space slot.",
  },
  {
    title: "Leaving frees a slot",
    description: "Leaving a Space immediately makes room for another one.",
  },
  {
    title: "Upgrade or make room",
    description:
      "At your limit, leave a Space or upgrade before creating another Space or accepting another invitation.",
  },
] as const;

export const pricingFaqs = [
  {
    q: "What counts toward my Space limit?",
    a: "Every Space you currently belong to counts, whether you created it or joined it. Pending invitations do not count, and leaving a Space frees a slot.",
  },
  {
    q: "Does joining a paid member’s Space upgrade my plan?",
    a: "No. Your Space limit and AI agent usage come from your own Misty plan, even when a Pro or Max member created the Space.",
  },
  {
    q: "How is AI agent usage measured?",
    a: "Misty measures the work agents perform rather than treating every request as identical. A short conversation uses less than analyzing a large collection of files or media. AI agent usage includes agent conversations, Space and Library questions, file or media analysis, Smart Library indexing, and other agent-powered work. Usage resets weekly.",
  },
  {
    q: "What happens when I reach my Space limit?",
    a: "You can leave an existing Space to free a slot or upgrade your plan. Until then, you cannot create another Space or accept another invitation.",
  },
] as const;
