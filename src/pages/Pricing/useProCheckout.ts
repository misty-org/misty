import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { useAuth } from "@/AuthContext";
import { createSubscriptionCheckout } from "./api";
import type { PricingInterval } from "./data";

/**
 * Starts Pro checkout, sending signed-out visitors through sign-in first. The
 * `?checkout=pro` parameter is what they come back to, so it is consumed once
 * per user/interval pair and then cleared from the URL.
 */
export function useProCheckout(
  onIntervalRestored: (interval: PricingInterval) => void,
) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  const checkoutAttempt = useRef("");
  const navigate = useNavigate();
  const { user } = useAuth();

  const openCheckout = useCallback(
    async (selectedInterval: PricingInterval) => {
      if (!user) {
        navigate("/signin", {
          state: {
            from: `/pricing?checkout=pro&interval=${selectedInterval}`,
          },
        });
        return;
      }

      setPending(true);
      setError("");
      try {
        const url = await createSubscriptionCheckout("pro", selectedInterval);
        window.location.assign(url);
      } catch (error) {
        setError(
          error instanceof Error ? error.message : "Unable to start checkout",
        );
        setPending(false);
      }
    },
    [navigate, user],
  );

  useEffect(() => {
    if (!user || searchParams.get("checkout") !== "pro") return;
    const selectedInterval =
      searchParams.get("interval") === "year" ? "year" : "month";
    const attemptKey = `${user.id}:${selectedInterval}`;
    if (checkoutAttempt.current === attemptKey) return;
    checkoutAttempt.current = attemptKey;
    onIntervalRestored(selectedInterval);
    setSearchParams({}, { replace: true });
    void openCheckout(selectedInterval);
  }, [
    onIntervalRestored,
    openCheckout,
    searchParams,
    setSearchParams,
    user,
  ]);

  return { openCheckout, pending, error };
}
