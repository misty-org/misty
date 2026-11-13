// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.
/**
 * Usage: two separate lists — invocation statistics (Claude Code transcripts; the scope is
 * stated, and "no data" is shown as such) and the log of changes made here.
 */
import { RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge, Button, cn, Skeleton, SkeletonControl, Spinner, Text } from "@/shared/ui";
import { EmptyLine, InlineError } from "./components";
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

const nameWidths = ["w-2/3", "w-1/2", "w-3/5"];

/** The invocations table's first load: the summary line, the header and three rows at the
 *  table's own 32px row height, the name in the wide column and three right-aligned figures. */
function InvocationsSkeleton() {
  const label = t("usage.invocations");
  return (
    <div role="status" aria-label={label} aria-busy="true" className="grid gap-2">
      <span className="sr-only">{label}</span>
      <div className="flex h-4 items-center">
        <Skeleton className="h-3 w-1/3" />
      </div>
      <div className="grid">
        <div className="grid h-6 grid-cols-6 items-center">
          <Skeleton className="col-span-3 h-2.5 w-12" />
          {[0, 1, 2].map((column) => (
            <Skeleton key={column} className="h-2.5 w-10 justify-self-end" />
          ))}
        </div>
        {[0, 1, 2].map((row) => (
          <div key={row} className="grid h-8 grid-cols-6 items-center border-t">
            <div className="col-span-3 pr-2">
              <Skeleton className={cn("h-3", nameWidths[row])} />
            </div>
            {[0, 1, 2].map((column) => (
              <Skeleton key={column} className="h-3 w-8 justify-self-end" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** The activity log's first load: three rows at the log's 32px height, each an action badge,
 *  the skill's name and the time at the right. */
function ActivitySkeleton() {
  const label = t("activity.title");
  return (
    <div role="status" aria-label={label} aria-busy="true" className="grid">
      <span className="sr-only">{label}</span>
      {[0, 1, 2].map((row) => (
        <div
          key={row}
          className="flex h-8 items-center justify-between gap-2 border-t first:border-t-0"
        >
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <SkeletonControl kind="badge" />
            <Skeleton className={cn("h-3", nameWidths[row])} />
          </div>
          <Skeleton className="h-3 w-20 shrink-0" />
        </div>
      ))}
    </div>
  );
}

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
  if (loading && !usage) return <InvocationsSkeleton />;
  // A failed refresh keeps the last statistics on screen, with the failure above them.
  if (error && !usage) return <InlineError message={error} />;
  const failure = error ? <InlineError message={error} /> : null;
  if (!usage || usage.scannedFiles === 0) {
    return (
      <>
        {failure}
        <EmptyLine text={t("usage.noData")} />
      </>
    );
  }
  if (usage.skills.length === 0) {
    return (
      <>
        {failure}
        <EmptyLine text={t("usage.noInvocations")} />
      </>
    );
  }
  return (
    <>
      {failure}
      <Text bare as="p" tone="muted" className="text-xs">
        {t("usage.summary", { files: usage.scannedFiles, total: usage.totalInvocations })}
        {usage.cached ? ` · ${t("discover.cached")}` : ""}
      </Text>
      <table className="w-full table-fixed text-sm">
        <thead>
          <tr className="text-left text-xs">
            <th className="w-1/2 py-1 font-normal">
              <Text bare tone="muted">
                {t("usage.skill")}
              </Text>
            </th>
            <th className="w-1/6 py-1 text-right font-normal">
              <Text bare tone="muted">
                {t("usage.calls")}
              </Text>
            </th>
            <th className="w-1/6 py-1 text-right font-normal">
              <Text bare tone="muted">
                {t("usage.tokens")}
              </Text>
            </th>
            <th className="w-1/6 py-1 text-right font-normal">
              <Text bare tone="muted">
                {t("usage.lastUsed")}
              </Text>
            </th>
          </tr>
        </thead>
        <tbody>
          {usage.skills.map((entry) => (
            <tr key={entry.skill} className="border-t">
              <td className="py-1.5 pr-2">
                <Text full tone="bright">
                  {entry.skill}
                </Text>
              </td>
              <td className="py-1.5 text-right tabular-nums">
                <Text bare tone="default">
                  {entry.invocations}
                </Text>
              </td>
              <td className="py-1.5 text-right tabular-nums">
                <Text bare tone="default">
                  {formatTokens(entry.tokens?.total_tokens)}
                </Text>
              </td>
              <td className="py-1.5 text-right">
                <Text bare tone="muted">
                  {entry.lastUsedAt ? dayFormat.format(new Date(entry.lastUsedAt)) : "—"}
                </Text>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {usage.unusedInstalled.length > 0 ? (
        <Text bare as="p" tone="muted" className="text-xs">
          {t("usage.unused", { count: usage.unusedInstalled.length })}
        </Text>
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
  if (loading && activity.length === 0) return <ActivitySkeleton />;
  if (error && activity.length === 0) return <InlineError message={error} />;
  if (activity.length === 0) return <EmptyLine text={t("activity.empty")} />;
  return (
    <>
      {error ? <InlineError message={error} /> : null}
      <ul className="flex flex-col">
        {activity.map((entry) => (
          <li
            key={`${entry.ts}-${entry.action}-${entry.directory ?? ""}-${entry.name ?? ""}`}
            className="flex items-center justify-between gap-2 border-t py-1.5 first:border-t-0"
          >
            <span className="flex min-w-0 items-center gap-2">
              <Badge variant="outline">
                {t(`activity.action.${ACTION_KEYS[entry.action] ?? "other"}`)}
              </Badge>
              <Text full tone="default" className="text-sm">
                {entry.name || entry.directory || ""}
              </Text>
            </span>
            <Text bare tone="muted" className="shrink-0 text-xs">
              {timeFormat.format(new Date(entry.ts))}
            </Text>
          </li>
        ))}
      </ul>
    </>
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
          <Text bare as="h3" tone="bright" weight="medium" className="text-sm">
            {t("usage.invocations")}
          </Text>
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
        <Text bare as="h3" tone="bright" weight="medium" className="text-sm">
          {t("activity.title")}
        </Text>
        <ActivityBody
          activity={usage.activity}
          loading={usage.activityLoading}
          error={usage.activityError}
        />
      </section>
      <Text bare as="p" tone="muted" className="text-xs">
        {t("usage.scope")} {t("activity.scope")}
      </Text>
    </div>
  );
}
