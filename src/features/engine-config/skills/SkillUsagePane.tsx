// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { Badge, ListRow, ListRowSkeleton, RowGroupSection, RowGroupStack, Text } from "@misty/ui";
import { EmptyLine, InlineError } from "./Components";
import { t } from "./strings";
import type { SkillActivityEntry, SkillUsageResult } from "./types";
import { useSkillUsage } from "./use_skill_usage";
import { formatTokens } from "./utils";

const ACTION_KEYS: Record<string, string> = {
  install: "install",
  uninstall: "uninstall",
  restore: "restore",
  set_targets: "setTargets",
  import: "import",
  delete_local: "deleteLocal",
};

function InvocationRows({ usage, loading }: { usage: SkillUsageResult | null; loading: boolean }) {
  if (loading && !usage)
    return <ListRowSkeleton label={t("usage.invocations")} rows={3} lines={2} state />;
  return (
    <>
      {(usage?.skills ?? []).map((entry) => (
        <ListRow
          key={entry.skill}
          label={entry.skill}
          description={t("usage.callsLine", {
            calls: entry.invocations,
            tokens: formatTokens(entry.tokens?.total_tokens),
          })}
          state={entry.lastUsedAt ? { kind: "time", at: entry.lastUsedAt } : undefined}
        />
      ))}
    </>
  );
}

function InvocationsSection({
  usage,
  loading,
  error,
  refreshing,
  onRefresh,
}: {
  usage: SkillUsageResult | null;
  loading: boolean;
  error: string | null;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const action = {
    label: t("common.refresh"),
    icon: RefreshCw,
    disabled: loading || refreshing,
    onSelect: onRefresh,
  };
  const failure = error ? <InlineError message={error} /> : null;
  if (error && !usage) return failure;
  const empty =
    usage && usage.scannedFiles === 0
      ? t("usage.noData")
      : usage && usage.skills.length === 0
        ? t("usage.noInvocations")
        : null;
  return (
    <div className="grid gap-2">
      {failure}
      {empty ? (
        <RowGroupSection title={t("usage.invocations")} action={action}>
          <EmptyLine text={empty} />
        </RowGroupSection>
      ) : (
        <RowGroupSection
          title={t("usage.invocations")}
          action={action}
          description={
            usage
              ? `${t("usage.summary", { files: usage.scannedFiles, total: usage.totalInvocations })}${
                  usage.cached ? ` ${t("usage.cached")}` : ""
                }`
              : undefined
          }
        >
          <InvocationRows usage={usage} loading={loading} />
        </RowGroupSection>
      )}
      {usage && usage.unusedInstalled.length > 0 ? (
        <Text bare as="p" size="meta" tone="muted" className="px-0.5">
          {t("usage.unused", { count: usage.unusedInstalled.length })}
        </Text>
      ) : null}
    </div>
  );
}

function ActivitySection({
  activity,
  loading,
  error,
}: {
  activity: SkillActivityEntry[];
  loading: boolean;
  error: string | null;
}) {
  if (error && activity.length === 0) return <InlineError message={error} />;
  return (
    <div className="grid gap-2">
      {error ? <InlineError message={error} /> : null}
      <RowGroupSection title={t("activity.title")}>
        {loading && activity.length === 0 ? (
          <ListRowSkeleton label={t("activity.title")} rows={3} state />
        ) : activity.length === 0 ? (
          <EmptyLine text={t("activity.empty")} />
        ) : (
          activity.map((entry) => (
            <ListRow
              key={`${entry.ts}-${entry.action}-${entry.directory ?? ""}-${entry.name ?? ""}`}
              label={entry.name || entry.directory || ""}
              badge={
                <Badge variant="outline">
                  {t(`activity.action.${ACTION_KEYS[entry.action] ?? "other"}`)}
                </Badge>
              }
              state={{ kind: "time", at: entry.ts }}
            />
          ))
        )}
      </RowGroupSection>
    </div>
  );
}

export function SkillUsagePane() {
  const usage = useSkillUsage(true);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = () => {
    if (refreshing) return;
    setRefreshing(true);
    void usage
      .refresh(true)
      .catch(() => undefined)
      .finally(() => setRefreshing(false));
  };

  return (
    <RowGroupStack className="w-full">
      <InvocationsSection
        usage={usage.usage}
        loading={usage.usageLoading}
        error={usage.usageError}
        refreshing={refreshing}
        onRefresh={refresh}
      />
      <ActivitySection
        activity={usage.activity}
        loading={usage.activityLoading}
        error={usage.activityError}
      />
      <Text bare as="p" size="meta" tone="muted" className="px-0.5">
        {t("usage.scope")} {t("activity.scope")}
      </Text>
    </RowGroupStack>
  );
}
