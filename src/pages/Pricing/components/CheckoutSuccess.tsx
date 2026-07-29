import { useEffect, useState } from "react";
import { NavLink } from "react-router";

import { useAuth } from "@/AuthContext";
import { PublicPage } from "@/components/marketing";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { formatStatus } from "@/lib/format";
import {
  fetchMe,
  type MeResponse,
} from "@/pages/AccountSettings/api";
import { useUserStore } from "@/store/userStore";

type ConfirmationState = "checking" | "confirmed" | "pending";

const syncDelays = [0, 400, 800, 1_200, 1_600, 2_000];

function isPaidPlan(account: MeResponse) {
  return account.tier === "pro" || account.tier === "max";
}

function formatPlan(tier: MeResponse["tier"]) {
  return tier === "max" ? "Max" : tier === "pro" ? "Pro" : "Basic";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "long",
  }).format(new Date(value));
}

function PlanDetails({ account }: { account: MeResponse }) {
  const periodEnd =
    account.billing?.current_period_end ?? account.expires_at ?? null;
  const status = account.billing?.cancel_at_period_end
    ? "Cancellation scheduled"
    : formatStatus(
        account.billing?.subscription_status ?? account.status,
      );
  const periodLabel = account.billing?.cancel_at_period_end
    ? "Access until"
    : account.billing?.kind === "trial"
      ? "Trial ends"
      : "Renews";

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <dl>
        <div className="flex min-h-20 items-center justify-between gap-6 border-b border-border px-6 py-5 sm:px-8">
          <dt className="text-base text-foreground sm:text-lg">Plan</dt>
          <dd className="m-0 text-right text-base font-medium text-foreground sm:text-lg">
            {formatPlan(account.tier)}
          </dd>
        </div>
        <div
          className={
            periodEnd
              ? "flex min-h-20 items-center justify-between gap-6 border-b border-border px-6 py-5 sm:px-8"
              : "flex min-h-20 items-center justify-between gap-6 px-6 py-5 sm:px-8"
          }
        >
          <dt className="text-base text-foreground sm:text-lg">Status</dt>
          <dd className="m-0 text-right text-base font-medium text-foreground sm:text-lg">
            {status}
          </dd>
        </div>
        {periodEnd ? (
          <div className="flex min-h-20 items-center justify-between gap-6 px-6 py-5 sm:px-8">
            <dt className="text-base text-foreground sm:text-lg">
              {periodLabel}
            </dt>
            <dd className="m-0 text-right text-base font-medium text-foreground sm:text-lg">
              {formatDate(periodEnd)}
            </dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

export default function CheckoutSuccess() {
  const { user, sessionReady } = useAuth();
  const setMe = useUserStore((store) => store.setMe);
  const [state, setState] = useState<ConfirmationState>("checking");
  const [account, setAccount] = useState<MeResponse | null>(null);
  const [retry, setRetry] = useState(0);
  const visibleState =
    sessionReady && !user ? ("signed-out" as const) : state;

  useEffect(() => {
    if (!sessionReady || !user) return;

    let active = true;

    async function confirmUpgrade() {
      setState("checking");
      setAccount(null);

      for (const delay of syncDelays) {
        if (delay > 0) {
          await new Promise((resolve) => window.setTimeout(resolve, delay));
        }
        if (!active) return;

        try {
          const nextAccount = await fetchMe();
          if (!active) return;
          setMe(nextAccount);
          if (isPaidPlan(nextAccount)) {
            setAccount(nextAccount);
            setState("confirmed");
            return;
          }
        } catch {
          // Stripe can redirect before the webhook and account refresh finish.
          // Keep retrying briefly before offering a manual retry.
        }
      }

      if (active) setState("pending");
    }

    void confirmUpgrade();

    return () => {
      active = false;
    };
  }, [retry, sessionReady, setMe, user]);

  return (
    <PublicPage className="min-h-[72vh]">
      <section
        aria-labelledby="checkout-success-heading"
        aria-live="polite"
        className="mx-auto w-full max-w-4xl py-8 sm:py-12"
      >
        {visibleState === "checking" ? (
          <div className="flex min-h-72 flex-col items-center justify-center text-center">
            <Spinner className="size-5" />
            <h1
              id="checkout-success-heading"
              className="mt-6 text-3xl font-medium tracking-[-0.035em] text-foreground sm:text-4xl"
            >
              Confirming your upgrade
            </h1>
            <p className="mt-4 max-w-xl text-base leading-7 text-muted-foreground">
              This usually takes only a moment.
            </p>
          </div>
        ) : null}

        {visibleState === "confirmed" && account ? (
          <>
            <div className="mb-10">
              <p className="text-sm font-medium text-muted-foreground">
                Checkout complete
              </p>
              <h1
                id="checkout-success-heading"
                className="mt-3 text-balance text-3xl font-medium tracking-[-0.035em] text-foreground sm:text-4xl"
              >
                Your {formatPlan(account.tier)} plan is ready.
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
                Your Misty account has been upgraded. Your new plan and billing
                details are shown below.
              </p>
            </div>

            <PlanDetails account={account} />

            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <NavLink to="/">Continue to Misty</NavLink>
              </Button>
              <Button asChild size="lg" variant="outline">
                <NavLink to="/settings">View billing settings</NavLink>
              </Button>
            </div>
          </>
        ) : null}

        {visibleState === "pending" ? (
          <div className="mx-auto max-w-2xl text-center">
            <h1
              id="checkout-success-heading"
              className="text-balance text-3xl font-medium tracking-[-0.035em] text-foreground sm:text-4xl"
            >
              Your plan is still syncing
            </h1>
            <p className="mt-4 text-base leading-7 text-muted-foreground">
              Checkout is complete, but Misty has not received the updated plan
              details yet. You can safely check again.
            </p>
            <Button
              type="button"
              size="lg"
              className="mt-8"
              onClick={() => setRetry((attempt) => attempt + 1)}
            >
              Check again
            </Button>
          </div>
        ) : null}

        {visibleState === "signed-out" ? (
          <div className="mx-auto max-w-2xl text-center">
            <h1
              id="checkout-success-heading"
              className="text-balance text-3xl font-medium tracking-[-0.035em] text-foreground sm:text-4xl"
            >
              Sign in to confirm your plan
            </h1>
            <p className="mt-4 text-base leading-7 text-muted-foreground">
              Your checkout finished, but you need to sign in before Misty can
              show the upgraded account.
            </p>
            <Button asChild size="lg" className="mt-8">
              <NavLink
                to="/signin"
                state={{ from: "/pricing?checkout=success" }}
              >
                Sign in
              </NavLink>
            </Button>
          </div>
        ) : null}
      </section>
    </PublicPage>
  );
}
