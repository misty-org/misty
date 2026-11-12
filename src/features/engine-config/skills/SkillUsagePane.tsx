// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.
/**
 * Usage: two separate lists — invocation statistics (Claude Code transcripts; the scope is
 * stated, and "no data" is shown as such) and the log of changes made here.
 */
import { RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge, Button, Spinner, OverflowFadeText } from "@/shared/ui";
import { EmptyLine, InlineError, SkillListSkeleton } from "./components";
import { t } from "./strings";
import type { SkillActivityEntry, SkillUsageResult } from "./types";
import { useSkillUsage } from "./useSkillUsage";
import { formatTokens } from "./utils";

const ACTION_KEYS: Record<string, string> = {
  install: "install",
  uninstall: "uninstall",
  restore: "restore",
  set_targets: "setTargets",
  import: "import",
  delete_local: "deleteLocal",
};

/** Invocation statistics. "No data" is kept apart from "no invocations": a scan that found no
 *  transcripts must not read as a list of unused skills. */
function InvocationsBody({
  usage,
  loading,
  error,
}: {
  usage: SkillUsageResult | null;
  loading: boolean;
  error: string | null;
}) {
  const dayFormat = useMemo(
    () => new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }),
    [],
  );
  if (loading && !usage) return <SkillListSkeleton label={t("usage.invocations")} rows={3} />;
  if (error) return <InlineError message={error} />;
  if (!usage || usage.scannedFiles === 0) return <EmptyLine text={t("usage.noData")} />;
  if (usage.skills.length === 0) return <EmptyLine text={t("usage.noInvocations")} />;
  return (
    <>
      <p className="text-xs text-cream-muted">
        {t("usage.summary", { files: usage.scannedFiles, total: usage.totalInvocations })}
        {usage.cached ? ` · ${t("discover.cached")}` : ""}
      </p>
      <table className="w-full table-fixed text-sm">
        <thead>
          <tr className="text-left text-xs text-cream-muted">
            <th className="w-1/2 py-1 font-normal">{t("usage.skill")}</th>
            <th className="w-1/6 py-1 text-right font-normal">{t("usage.calls")}</th>
            <th className="w-1/6 py-1 text-right font-normal">{t("usage.tokens")}</th>
            <th className="w-1/6 py-1 text-right font-normal">{t("usage.lastUsed")}</th>
          </tr>
        </thead>
        <tbody>
          {usage.skills.map((entry) => (
            <tr key={entry.skill} className="border-t border-charcoal-border">
              <td className="truncate py-1.5 pr-2 text-cream-bright" title={entry.skill}>
                {entry.skill}
              </td>
              <td className="py-1.5 text-right tabular-nums text-cream">{entry.invocations}</td>
              <td className="py-1.5 text-right tabular-nums text-cream">
                {formatTokens(entry.tokens?.total_tokens)}
              </td>
              <td className="py-1.5 text-right text-cream-muted">
                {entry.lastUsedAt ? dayFormat.format(new Date(entry.lastUsedAt)) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {usage.unusedInstalled.length > 0 ? (
        <p className="text-xs text-cream-muted">
          {t("usage.unused", { count: usage.unusedInstalled.length })}
        </p>
      ) : null}
    </>
  );
}

/** The log of installs, uninstalls, restores and imports. */
function ActivityBody({
  activity,
  loading,
  error,
}: {
  activity: SkillActivityEntry[];
  loading: boolean;
  error: string | null;
}) {
  const timeFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
    [],
  );
  if (loading && activity.length === 0) {
    return <SkillListSkeleton label={t("activity.title")} rows={3} />;
  }
  if (error) return <InlineError message={error} />;
  if (activity.length === 0) return <EmptyLine text={t("activity.empty")} />;
  return (
    <ul className="flex flex-col">
      {activity.map((entry) => (
        <li
          key={`${entry.ts}-${entry.action}-${entry.directory ?? ""}-${entry.name ?? ""}`}
          className="flex items-center justify-between gap-2 border-t border-charcoal-border py-1.5 first:border-t-0"
        >
          <span className="flex min-w-0 items-center gap-2">
            <Badge variant="outline">
              {t(`activity.action.${ACTION_KEYS[entry.action] ?? "other"}`)}
            </Badge>
            <OverflowFadeText full className="text-sm text-cream">
              {entry.name || entry.directory || ""}
            </OverflowFadeText>
          </span>
          <span className="shrink-0 text-xs text-cream-muted">
            {timeFormat.format(new Date(entry.ts))}
          </span>
        </li>
      ))}
    </ul>
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
    <div className="flex w-full flex-col gap-5">
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-cream-bright">{t("usage.invocations")}</h3>
          <Button disabled={usage.usageLoading || refreshing} onClick={refresh}>
            {refreshing ? <Spinner size="sm" label={false} /> : <RefreshCw aria-hidden />}
            {t("common.refresh")}
          </Button>
        </div>
        <InvocationsBody
          usage={usage.usage}
          loading={usage.usageLoading}
          error={usage.usageError}
        />
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-cream-bright">{t("activity.title")}</h3>
        <ActivityBody
          activity={usage.activity}
          loading={usage.activityLoading}
          error={usage.activityError}
        />
      </section>
      <p className="text-xs text-cream-muted">
        {t("usage.scope")} {t("activity.scope")}
      </p>
    </div>
  );
}
