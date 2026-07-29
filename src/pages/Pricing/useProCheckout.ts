import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { useAuth } from "@/AuthContext";
import type { MeResponse } from "@/pages/AccountSettings/api";
import { useUserStore } from "@/store/userStore";
import { createSubscriptionCheckout } from "./api";
import type { PaidTier, PricingInterval } from "./data";

function effectivePaidTier(me: MeResponse | null): PaidTier | null {
  if (
    me?.allows_use &&
    (me.status === "active" || me.status === "trialing") &&
    (me?.tier === "pro" || me?.tier === "max")
  ) {
    return me.tier;
  }
  return null;
}

function hasManagedSubscription(me: MeResponse | null): boolean {
  return (
    effectivePaidTier(me) !== null &&
    (me?.billing?.kind === "subscription" || me?.billing?.kind === "trial")
  );
}

function planName(tier: PaidTier): string {
  return tier === "max" ? "Max" : "Pro";
}

function currentPlanMessage(tier: PaidTier, managed: boolean): string {
  return managed
    ? `Your ${planName(tier)} subscription is already active and renews automatically.`
    : `You're already on the ${planName(tier)} plan.`;
}

function shouldRefreshAfterCheckoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const status = (error as Error & { status?: number }).status;
  return status === 409 || error.message === "Checkout did not return a URL";
}

/**
 * Starts paid-plan checkout, sending signed-out visitors through sign-in first.
 * The checkout parameter is what they come back to, so it is consumed once
 * per user/interval pair and then cleared from the URL.
 */
export function usePaidCheckout(
  onIntervalRestored: (interval: PricingInterval) => void,
) {
  const [pendingTier, setPendingTier] = useState<PaidTier | null>(null);
  const [error, setError] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  const checkoutAttempt = useRef("");
  const navigate = useNavigate();
  const { user, sessionReady, refreshSession } = useAuth();
  const me = useUserStore((store) => store.me);
  const currentPlanTier = effectivePaidTier(me);
  const managedSubscription = hasManagedSubscription(me);

  const openCheckout = useCallback(
    async (tier: PaidTier, selectedInterval: PricingInterval) => {
      if (!sessionReady) return;

      if (tier === currentPlanTier) {
        setError(currentPlanMessage(tier, managedSubscription));
        return;
      }

      if (!user) {
        navigate("/signin", {
          state: {
            from: `/pricing?checkout=${tier}&interval=${selectedInterval}`,
          },
        });
        return;
      }

      setPendingTier(tier);
      setError("");
      try {
        const url = await createSubscriptionCheckout(tier, selectedInterval);
        window.location.assign(url);
      } catch (error) {
        if (shouldRefreshAfterCheckoutError(error)) {
          try {
            const account = await refreshSession();
            const refreshedTier = effectivePaidTier(account);
            if (refreshedTier === tier) {
              setError(
                currentPlanMessage(
                  tier,
                  hasManagedSubscription(account),
                ),
              );
              return;
            }
          } catch {
            // Preserve the original checkout error if session refresh fails.
          }
        }
        setError(
          error instanceof Error ? error.message : "Unable to start checkout",
        );
      } finally {
        setPendingTier(null);
      }
    },
    [
      currentPlanTier,
      managedSubscription,
      navigate,
      refreshSession,
      sessionReady,
      user,
    ],
  );

  useEffect(() => {
    const checkoutTier = searchParams.get("checkout");
    if (!user || (checkoutTier !== "pro" && checkoutTier !== "max")) {
      return;
    }
    const selectedInterval =
      searchParams.get("interval") === "year" ? "year" : "month";
    const attemptKey = `${user.id}:${checkoutTier}:${selectedInterval}`;
    if (checkoutAttempt.current === attemptKey) return;
    checkoutAttempt.current = attemptKey;
    onIntervalRestored(selectedInterval);
    setSearchParams({}, { replace: true });
    void openCheckout(checkoutTier, selectedInterval);
  }, [onIntervalRestored, openCheckout, searchParams, setSearchParams, user]);

  return {
    openCheckout,
    pendingTier,
    error,
    currentPlanTier,
    hasManagedSubscription: managedSubscription,
    checkoutReady: sessionReady,
  };
}
