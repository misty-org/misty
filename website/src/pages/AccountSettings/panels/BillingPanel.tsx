import { Button } from "@/components/ui/button";
import { formatStatus } from "@/lib/format";
import { PRICING_MODEL } from "@/pages/Pricing/data";
import {
  createBillingPortal,
  createSubscriptionCheckout,
  type BillingUsageResponse,
  type MeResponse,
} from "../api";
import { TIER_LABEL } from "../components/accountTone";
import {
  customRowClass,
  ErrorRow,
  LoadingRow,
  Row,
  Section,
} from "../components/SettingsRows";

/**
 * The server returns these period dates as nullable timestamps — a trial with no
 * recorded end, a subscription mid-transition. `new Date(null)` yields an
 * Invalid Date and renders as literal "Invalid Date", so guard first.
 */
function formatDateOrDash(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleDateString();
}

function PlanRows({
  me,
  usage,
}: {
  me: MeResponse;
  usage: BillingUsageResponse | null;
}) {
  const plan = usage?.plan ?? me.tier;
  const trial = usage?.trial;
  const subscription = usage?.subscription;

  return (
    <>
      <Row label="Plan">{TIER_LABEL[plan] ?? plan}</Row>
      {trial ? (
        <>
          <Row label="Trial status">{formatStatus(trial.status)}</Row>
          <Row label="Trial ends">{formatDateOrDash(trial.ends_at)}</Row>
        </>
      ) : subscription ? (
        <>
          <Row label="Subscription status">
            {subscription.cancel_at_period_end
              ? "Cancellation scheduled"
              : formatStatus(subscription.status)}
          </Row>
          <Row label="Billing interval">
            {subscription.billing_interval === "year" ? "Yearly" : "Monthly"}
          </Row>
          <Row
            label={
              subscription.cancel_at_period_end ? "Access until" : "Renews"
            }
          >
            {formatDateOrDash(subscription.current_period_end)}
          </Row>
        </>
      ) : (
        <Row label="Status">{formatStatus(me.status)}</Row>
      )}
    </>
  );
}

function UpgradeOffer({
  disabled,
  trialEligible,
  onBillingAction,
}: {
  disabled: boolean;
  trialEligible: boolean;
  onBillingAction: (action: () => Promise<{ url: string }>) => void;
}) {
  return (
    <div className={`${customRowClass} grid gap-3`}>
      <p className="m-0 text-sm font-medium text-foreground">
        Upgrade to Pro for {PRICING_MODEL.pro.storage} of pooled owner storage
        and {PRICING_MODEL.pro.agentUsage}.
      </p>
      <p className="m-0 text-sm leading-6 text-muted-foreground">
        {trialEligible
          ? `Start with a one-time ${PRICING_MODEL.pro.trialDays}-day trial. A card is required, and your plan automatically renews unless canceled.`
          : "Your one-time trial has already been used. Subscribe directly to restore Pro access."}{" "}
        There are no automatic overages or surprise charges.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={disabled}
          onClick={() =>
            onBillingAction(() => createSubscriptionCheckout("pro", "month"))
          }
        >
          {trialEligible ? "Start Pro trial" : "Subscribe monthly"} ·{" "}
          {PRICING_MODEL.pro.monthlyPrice}/mo
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() =>
            onBillingAction(() => createSubscriptionCheckout("pro", "year"))
          }
        >
          {trialEligible ? "Start annual trial" : "Subscribe yearly"} ·{" "}
          {PRICING_MODEL.pro.yearlyPrice}/yr
        </Button>
      </div>
    </div>
  );
}

export function BillingPanel({
  me,
  usage,
  loading,
  loadError,
  billingWorking,
  billingError,
  onBillingAction,
}: {
  me: MeResponse | null;
  usage: BillingUsageResponse | null;
  loading: boolean;
  loadError: string;
  billingWorking: boolean;
  billingError: string;
  onBillingAction: (action: () => Promise<{ url: string }>) => void;
}) {
  const plan = usage?.plan ?? me?.tier;
  const trial = usage?.trial;
  const subscription = usage?.subscription;
  const canManageBilling =
    Boolean(me?.billing?.customer_portal_available) &&
    (me?.billing?.kind === "subscription" || me?.billing?.kind === "trial");

  return (
    <div>
      <Section title="Plan">
        {loading && !me ? <LoadingRow label="Loading plan details" /> : null}

        {loadError && !me ? (
          <ErrorRow title="Plan details are unavailable" message={loadError} />
        ) : null}

        {me ? <PlanRows me={me} usage={usage} /> : null}
      </Section>

      <Section title="Billing">
        {canManageBilling ? (
          <>
            <Row label="Current plan">
              {trial
                ? "Pro trial"
                : `${TIER_LABEL[plan ?? "pro"]} · ${subscription?.billing_interval === "year" || me?.billing?.interval === "year" ? "yearly" : "monthly"}`}
            </Row>
            <div className={customRowClass}>
              <Button
                type="button"
                disabled={billingWorking}
                onClick={() => onBillingAction(createBillingPortal)}
              >
                Manage billing
              </Button>
            </div>
          </>
        ) : (
          <UpgradeOffer
            disabled={billingWorking}
            trialEligible={me?.trial_eligible === true}
            onBillingAction={onBillingAction}
          />
        )}

        {billingError ? (
          <ErrorRow
            title="Billing is temporarily unavailable"
            message={billingError}
          />
        ) : null}
      </Section>
    </div>
  );
}
