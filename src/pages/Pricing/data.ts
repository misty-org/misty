export type PricingInterval = "month" | "year";

export const plans = [
  {
    id: "free",
    name: "Free",
    description: "For small projects.",
    prices: {
      month: { price: "$0", period: "forever" },
      year: { price: "$0", period: "forever" },
    },
    features: [
      "Own up to 3 Spaces",
      "Join up to 5 Spaces",
      "5 people per owned Space",
      "2 GB shared owner Library pool",
      "100 monthly Mika credits · Mika Low",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    description: "For active teams.",
    prices: {
      month: { price: "$8.99", period: "per month" },
      year: { price: "$89", period: "per year · save $18.88" },
    },
    features: [
      "Own up to 10 Spaces",
      "Join up to 25 Spaces",
      "15 people per owned Space",
      "50 GB shared owner Library pool",
      "2,000 monthly Mika credits · Mika Med",
    ],
  },
  {
    id: "max",
    name: "Max",
    description: "For larger groups.",
    prices: {
      month: { price: "$19.99", period: "per month" },
      year: { price: "$199", period: "per year · save $40.88" },
    },
    features: [
      "Own up to 25 Spaces",
      "Join up to 100 Spaces",
      "50 people per owned Space",
      "250 GB shared owner Library pool",
      "6,000 monthly Mika credits · Mika High",
    ],
  },
] as const;

export const planLimitRows = [
  { label: "Price", free: "$0", pro: "$8.99 monthly / $89 yearly", max: "$19.99 monthly / $199 yearly" },
  { label: "Owned Spaces", free: "3", pro: "10", max: "25" },
  { label: "Joined Spaces", free: "5", pro: "25", max: "100" },
  { label: "People per owned Space", free: "5", pro: "15", max: "50" },
  { label: "Owner Library pool", free: "2 GB", pro: "50 GB", max: "250 GB" },
  { label: "Monthly Mika", free: "100 credits · Mika Low", pro: "2,000 credits · Mika Med", max: "6,000 credits · Mika High" },
] as const;

export const ownerRules = [
  {
    title: "The owner sets Space capacity",
    description:
      "A Space uses its owner’s people limit and shared Library pool, even when other members upload files.",
  },
  {
    title: "Membership stays flexible",
    description:
      "Free members can join Spaces owned by Pro or Max members. Nobody has to upgrade just to participate.",
  },
  {
    title: "Your plan travels with you",
    description:
      "Your subscription controls how many Spaces you can own or join and which Mika tier you can use.",
  },
  {
    title: "Mika credits stay personal",
    description:
      "The member making a Mika request uses their own credits. Space owners never pay another member’s Mika usage.",
  },
] as const;

export const permanentCreditPacks = [
  { name: "1,500 credits", price: "$4.99 once", detail: "Non-expiring top-up" },
  { name: "3,500 credits", price: "$9.99 once", detail: "Non-expiring top-up" },
] as const;

export const subscriberRefills = [
  {
    name: "Pro refill",
    credits: "2,000 credits",
    price: "$4.99",
    detail: "Added for the current billing period",
  },
  {
    name: "Max refill",
    credits: "6,000 credits",
    price: "$14.99",
    detail: "Added for the current billing period",
  },
] as const;
