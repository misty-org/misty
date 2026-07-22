export const PRICING_MODEL = {
  free: {
    id: "free",
    name: "Free",
    monthlyPrice: "$0",
    yearlyPrice: "$0",
    storage: "2 GB",
    hostedAI: "Weekly Hosted AI usage",
    modelRouting: "Same automatic model routing as Pro",
  },
  pro: {
    id: "pro",
    name: "Pro",
    monthlyPrice: "$9",
    yearlyPrice: "$89",
    storage: "50 GB",
    hostedAI: "over 6× more Hosted AI capacity",
    modelRouting: "Same automatic model routing as Free",
    trialDays: 14,
  },
} as const;

export const SHARED_PLAN_FEATURES = [
  "Unlimited Spaces",
  "Unlimited collaborators",
  "Unlimited custom agents",
] as const;

export type CustomerPlanId = keyof typeof PRICING_MODEL;
export type PaidTier = "pro";
export type BillingInterval = "month" | "year";
