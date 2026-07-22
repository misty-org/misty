import {
  PRICING_MODEL,
  SHARED_PLAN_FEATURES,
  type BillingInterval,
} from "@/lib/pricing";

export type PricingInterval = BillingInterval;

export const plans = [
  {
    id: "free",
    name: PRICING_MODEL.free.name,
    description:
      "For getting work out of group chats and into one shared place.",
    prices: {
      month: { price: PRICING_MODEL.free.monthlyPrice, period: "forever" },
      year: { price: PRICING_MODEL.free.yearlyPrice, period: "forever" },
    },
    features: [
      ...SHARED_PLAN_FEATURES,
      `${PRICING_MODEL.free.storage} total storage across Spaces you own`,
      PRICING_MODEL.free.hostedAI,
      PRICING_MODEL.free.modelRouting,
    ],
  },
  {
    id: "pro",
    name: PRICING_MODEL.pro.name,
    description:
      "For groups that need more room and more Hosted AI every week.",
    prices: {
      month: { price: PRICING_MODEL.pro.monthlyPrice, period: "per month" },
      year: {
        price: PRICING_MODEL.pro.yearlyPrice,
        period: "per year · save $19",
      },
    },
    features: [
      ...SHARED_PLAN_FEATURES,
      `${PRICING_MODEL.pro.storage} total storage across Spaces you own`,
      PRICING_MODEL.pro.hostedAI,
      PRICING_MODEL.pro.modelRouting,
      `One-time ${PRICING_MODEL.pro.trialDays}-day trial`,
      "Card required · automatically renews",
    ],
  },
] as const;

export const planLimitRows = [
  {
    label: "Price",
    free: PRICING_MODEL.free.monthlyPrice,
    pro: `${PRICING_MODEL.pro.monthlyPrice} monthly / ${PRICING_MODEL.pro.yearlyPrice} yearly`,
  },
  { label: "Owned and joined Spaces", free: "Unlimited", pro: "Unlimited" },
  { label: "Collaborators", free: "Unlimited", pro: "Unlimited" },
  { label: "Custom agents", free: "Unlimited", pro: "Unlimited" },
  {
    label: "Storage pooled across owned Spaces",
    free: PRICING_MODEL.free.storage,
    pro: PRICING_MODEL.pro.storage,
  },
  {
    label: "Hosted AI usage",
    free: "Weekly usage",
    pro: PRICING_MODEL.pro.hostedAI,
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
    title: "Collaboration stays unlimited",
    description:
      "Joining Spaces and collaborating do not use your storage. Only hosted files in Spaces you own count toward your pool.",
  },
  {
    title: "Hosted AI usage stays personal",
    description:
      "Hosted AI usage resets weekly. Misty shows the percentage used and reset date, never a dollar or usage-unit balance.",
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
    q: "What happens when I reach my Hosted AI limit?",
    a: "New Hosted AI work pauses until your weekly reset or until you upgrade. Files, Spaces, conversations, and collaboration keep working, and there are no automatic overages.",
  },
  {
    q: "Does Pro start with a trial?",
    a: "Yes. Monthly and yearly Pro subscriptions begin with a one-time 14-day trial. A card is required, and the plan automatically renews unless you cancel.",
  },
  {
    q: "Do Free and Pro use different AI models?",
    a: "No. Both plans use the same automatic model routing. Pro simply gives you over 6× more Hosted AI capacity.",
  },
  {
    q: "How does Misty handle my data?",
    a: "Private files stay local or with the connected provider until copied into a Space. Agents only use context you are permitted to access. If you exceed storage, existing data remains intact and nothing is automatically deleted.",
  },
  {
    q: "Can usage create an extra bill?",
    a: "No. Misty never charges beyond your plan automatically. Hosted AI usage and new hosted uploads pause at their limits, so there are no automatic overages or surprise charges.",
  },
] as const;
