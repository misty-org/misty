import { apiBase } from "../../lib/apiBase";
import type { BillingInterval, PaidTier } from "./data";

export async function createSubscriptionCheckout(
  tier: PaidTier,
  interval: BillingInterval,
): Promise<string> {
  const response = await fetch(`${apiBase}/billing/checkout-session`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tier, interval }),
  });

  if (!response.ok) {
    const message = (await response.text()).trim();
    throw Object.assign(
      new Error(message || "Unable to start checkout"),
      { status: response.status },
    );
  }

  const result = (await response.json()) as { url?: string };
  if (!result.url) throw new Error("Checkout did not return a URL");
  return result.url;
}
