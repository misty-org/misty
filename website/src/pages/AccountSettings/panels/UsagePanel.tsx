import { Progress } from "@/components/ui/progress";
import { formatBytes } from "@/lib/format";
import type { BillingUsageResponse } from "../api";
import {
  customRowClass,
  ErrorRow,
  LoadingRow,
  Row,
  Section,
} from "../components/SettingsRows";
import type { LoadState } from "../useAccountSettings";

function storageQuotaNotice(storage: BillingUsageResponse["storage"]): string {
  const noticeDate = storage.cleanup_notice_until
    ? new Date(storage.cleanup_notice_until)
    : null;
  const followUp =
    noticeDate && Number.isFinite(noticeDate.getTime())
      ? ` We’ll keep this notice visible through ${noticeDate.toLocaleDateString()}.`
      : "";
  return `New hosted uploads are paused because the pooled owner storage is over quota. Existing data remains intact, and nothing is automatically deleted.${followUp}`;
}

function agentUsageNotice(usedPercent: number): string {
  if (usedPercent >= 100) {
    return "Agent usage is paused until the weekly reset or a Pro upgrade. Files and collaboration still work, with no automatic overage.";
  }
  if (usedPercent >= 90) {
    return "You have used at least 90% of this week’s agent usage.";
  }
  if (usedPercent >= 75) {
    return "You have used at least 75% of this week’s agent usage.";
  }
  return "";
}

export function UsagePanel({
  usage,
  state,
  error,
  onRetry,
}: {
  usage: BillingUsageResponse | null;
  state: LoadState;
  error: string;
  onRetry: () => void;
}) {
  const agentUsedPercent = usage
    ? Math.round(Math.min(1, Math.max(0, usage.hosted_ai.used_ratio)) * 100)
    : 0;
  const storageUsedPercent = usage
    ? usage.storage.limit_bytes > 0
      ? Math.min(
          100,
          Math.round(
            (usage.storage.used_bytes / usage.storage.limit_bytes) * 100,
          ),
        )
      : 0
    : 0;
  const agentWarning = agentUsageNotice(agentUsedPercent);

  return (
    <div>
      <Section title="Storage">
        {state === "loading" || state === "idle" ? (
          <LoadingRow label="Loading usage" />
        ) : null}

        {state === "error" ? (
          <ErrorRow
            title="Usage is unavailable"
            message={error}
            onRetry={onRetry}
          />
        ) : null}

        {state === "ready" && usage ? (
          <>
            <Row label="Owner pool">
              {formatBytes(usage.storage.used_bytes)} of{" "}
              {formatBytes(usage.storage.limit_bytes)} used
            </Row>
            <Row label="Available">
              {formatBytes(usage.storage.remaining_bytes)}
            </Row>
            <div className={customRowClass}>
              <Progress
                value={storageUsedPercent}
                aria-label={`${storageUsedPercent}% of owner storage used`}
              />
              {usage.storage.over_quota ? (
                <p className="mt-2 text-xs text-[var(--settings-warning)]">
                  {storageQuotaNotice(usage.storage)}
                </p>
              ) : null}
            </div>
          </>
        ) : null}
      </Section>

      <Section title="Agent usage">
        {state === "ready" && usage ? (
          <>
            <Row label="This week">{agentUsedPercent}% used</Row>
            <Row label="Weekly reset">
              {new Date(usage.hosted_ai.reset_at).toLocaleDateString()}
            </Row>
            <div className={customRowClass}>
              <Progress
                value={agentUsedPercent}
                aria-label={`${agentUsedPercent}% of weekly agent usage`}
              />
              {agentWarning ? (
                <p className="mt-2 text-xs text-[var(--settings-warning)]">
                  {agentWarning}
                </p>
              ) : null}
            </div>
          </>
        ) : null}
      </Section>
    </div>
  );
}
