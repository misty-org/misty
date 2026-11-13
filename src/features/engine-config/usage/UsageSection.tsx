// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

/**
 * Settings › Engines › Usage: plan limits with reset times, read through each CLI, and usage by
 * day, engine, model and folder from the CLIs' own logs, priced from LiteLLM's table. In
 * desktop-cc-gui this view ships as a separate plugin on the same native data; here it is a
 * Settings block.
 */
import {
  DesktopSettingsNotice,
  DesktopSettingsRow,
  DesktopSettingsSection,
} from "@/features/settings";
import { EngineMark } from "../EngineMark";
import {
  Button,
  ChoiceGroup,
  Progress,
  Skeleton,
  SkeletonList,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  localDay,
  onUsageChanged,
  queryUsage,
  rescanUsage,
  updateUsagePrices,
  usageLimits,
  usagePrices,
  usageSources,
  type ProviderLimits,
  type UsagePriceInfo,
  type UsageQueryResult,
  type UsageSource,
} from "./usageApi";
import {
  dailyTotals,
  engineName,
  folderLabel,
  formatCost,
  formatReset,
  formatTokens,
  groupRows,
  limitsStatusText,
  windowName,
  type UsageGroup,
} from "./usageFormat";

type Range = "7" | "30" | "90";

const ranges: { value: Range; label: string }[] = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
];

const groups: { value: UsageGroup; label: string }[] = [
  { value: "engine", label: "Engine" },
  { value: "model", label: "Model" },
  { value: "project", label: "Folder" },
];

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

function rangeDates(days: number) {
  const to = new Date();
  const from = new Date(to.getTime() - (days - 1) * 86_400_000);
  return { from: localDay(from), to: localDay(to) };
}

/** Ticks once a minute, for reset countdowns. */
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

export function UsageSection() {
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      {error ? <DesktopSettingsNotice>{error}</DesktopSettingsNotice> : null}
      <LimitsBlock onError={setError} />
      <UsageBlock onError={setError} />
      <SourcesBlock onError={setError} />
    </>
  );
}

function LimitsBlock(props: { onError: (error: string | null) => void }) {
  const { onError } = props;
  const [providers, setProviders] = useState<ProviderLimits[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const now = useNow();
  const load = useCallback(
    async (refresh: boolean) => {
      setRefreshing(refresh);
      try {
        setProviders((await usageLimits({ refresh })).providers);
      } catch (error) {
        onError(message(error));
      } finally {
        setRefreshing(false);
      }
    },
    [onError],
  );
  useEffect(() => {
    void load(false);
  }, [load]);
  return (
    <DesktopSettingsSection title="Plan limits">
      {providers === null ? (
        <SkeletonList leading="icon" lines={2} label="Plan limits" rows={2} trailing />
      ) : (
        providers.map((limits) => (
          <ProviderRow
            key={limits.id}
            limits={limits}
            now={now}
            refreshing={refreshing}
            onRefresh={limits.id === "codex" ? () => void load(true) : undefined}
          />
        ))
      )}
    </DesktopSettingsSection>
  );
}

function ProviderRow(props: {
  limits: ProviderLimits;
  now: number;
  refreshing: boolean;
  onRefresh?: () => void;
}) {
  const { limits, now } = props;
  const status = limitsStatusText(limits);
  const label = `${engineName(limits.id)}${limits.plan ? ` · ${limits.plan}` : ""}`;
  return (
    <DesktopSettingsRow label={label} description={status ?? undefined} stacked>
      <div className="grid w-full gap-3">
        {limits.windows.map((window) => {
          const reset = formatReset(window.resetsAt, now);
          return (
            <div key={window.id} className="grid gap-1.5">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="flex items-center gap-2 text-cream">
                  <EngineMark engine={limits.id} size={12} />
                  {windowName(window)}
                  {window.status === "rejected" ? (
                    <span className="text-cream-bright">· Limit reached</span>
                  ) : null}
                </span>
                <span className="tabular-nums text-cream-muted">
                  {Math.round(window.usedPercent)}% used{reset ? ` · ${reset}` : ""}
                </span>
              </div>
              <Progress value={window.usedPercent} aria-label={`${windowName(window)} used`} />
            </div>
          );
        })}
        {limits.credits && (limits.credits.hasCredits || limits.credits.unlimited) ? (
          <span className="text-sm text-cream-muted">
            Credits:{" "}
            {limits.credits.unlimited ? "Unlimited" : (limits.credits.balance ?? "Available")}
          </span>
        ) : null}
        {limits.usingOverage ? (
          <span className="text-sm text-cream-muted">Using extra usage beyond the plan</span>
        ) : null}
        {props.onRefresh ? (
          <div>
            <Button type="button" disabled={props.refreshing} onClick={props.onRefresh}>
              Check again
            </Button>
          </div>
        ) : null}
      </div>
    </DesktopSettingsRow>
  );
}

function UsageBlock(props: { onError: (error: string | null) => void }) {
  const { onError } = props;
  const [range, setRange] = useState<Range>("7");
  const [group, setGroup] = useState<UsageGroup>("engine");
  const [result, setResult] = useState<UsageQueryResult | null>(null);
  const dates = useMemo(() => rangeDates(Number(range)), [range]);
  const load = useCallback(async () => {
    try {
      setResult(await queryUsage({ ...dates, bucket: "day" }));
    } catch (error) {
      onError(message(error));
    }
  }, [dates, onError]);
  useEffect(() => {
    void load();
    return onUsageChanged(() => void load());
  }, [load]);
  const rows = useMemo(() => result?.rows ?? [], [result]);
  const totals = useMemo(() => groupRows(rows, "engine"), [rows]);
  const grouped = useMemo(() => groupRows(rows, group), [rows, group]);
  const days = useMemo(() => dailyTotals(rows, dates.from, dates.to), [rows, dates]);
  const sum = totals.reduce(
    (all, entry) => ({
      tokens: all.tokens + entry.tokens,
      cost: all.cost + entry.cost,
      requests: all.requests + entry.requests,
      unpriced: all.unpriced || entry.unpriced,
    }),
    { tokens: 0, cost: 0, requests: 0, unpriced: false },
  );
  const peak = Math.max(1, ...days.map((day) => day.tokens));
  return (
    <DesktopSettingsSection title="Usage">
      <div className="flex flex-wrap items-center justify-between gap-3 py-3">
        <ChoiceGroup label="Range" value={range} options={ranges} onChange={setRange} />
        <ChoiceGroup label="Group by" value={group} options={groups} onChange={setGroup} />
      </div>
      {result === null ? (
        <div role="status" aria-label="Usage" aria-busy="true" className="grid gap-3 py-3">
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-28 w-full" />
          <SkeletonList leading="icon" label="Usage" rows={3} lines={1} trailing />
        </div>
      ) : (
        <div className="grid gap-4 py-3">
          <div className="flex flex-wrap gap-x-8 gap-y-2">
            <Figure label="Tokens" value={formatTokens(sum.tokens)} />
            <Figure label="Estimated cost" value={formatCost(sum.cost, sum.unpriced)} />
            <Figure label="Requests" value={sum.requests.toLocaleString("en-US")} />
          </div>
          <div
            role="img"
            aria-label={`Tokens per day, ${dates.from} to ${dates.to}`}
            className="flex h-28 items-end gap-px"
          >
            {days.map((day) => (
              <div
                key={day.day}
                title={`${day.day}: ${formatTokens(day.tokens)} tokens, ${formatCost(day.cost)}`}
                className="flex h-full min-w-0 flex-1 items-end"
              >
                <div
                  className="w-full rounded-sm bg-cream-muted/50"
                  style={{ height: `${Math.max(day.tokens ? 2 : 0, (day.tokens / peak) * 100)}%` }}
                />
              </div>
            ))}
          </div>
          {grouped.length === 0 ? (
            <p className="text-sm text-cream-muted">No usage in this range</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{groups.find((g) => g.value === group)?.label}</TableHead>
                  <TableHead className="text-right">Requests</TableHead>
                  <TableHead className="text-right">Input</TableHead>
                  <TableHead className="text-right">Output</TableHead>
                  <TableHead className="text-right">Cache</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {grouped.map((entry) => (
                  <TableRow key={entry.key}>
                    <TableCell className="max-w-[240px] truncate" title={entry.key}>
                      <span className="flex items-center gap-2">
                        {group === "engine" ? (
                          <EngineMark engine={entry.key} size={12} name={engineName(entry.key)} />
                        ) : null}
                        {group === "engine"
                          ? engineName(entry.key)
                          : group === "project"
                            ? folderLabel(entry.key)
                            : entry.key}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {entry.requests.toLocaleString("en-US")}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatTokens(entry.input)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatTokens(entry.output)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatTokens(entry.cache)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {entry.unpriced && entry.cost === 0
                        ? "No price"
                        : formatCost(entry.cost, entry.unpriced)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}
    </DesktopSettingsSection>
  );
}

function Figure(props: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5">
      <span className="text-sm text-cream-muted">{props.label}</span>
      <span className="text-lg font-semibold tabular-nums text-cream-bright">{props.value}</span>
    </div>
  );
}

const sourceStatus: Record<UsageSource["status"], string> = {
  ok: "",
  missing: "No logs yet",
  denied: "Misty can't read this folder",
  error: "Couldn't read this folder",
};

function SourcesBlock(props: { onError: (error: string | null) => void }) {
  const { onError } = props;
  const [sources, setSources] = useState<UsageSource[] | null>(null);
  const [prices, setPrices] = useState<UsagePriceInfo | null>(null);
  const [busy, setBusy] = useState<"rescan" | "prices" | null>(null);
  const load = useCallback(async () => {
    try {
      const [found, table] = await Promise.all([usageSources(), usagePrices()]);
      setSources(found);
      setPrices(table);
    } catch (error) {
      onError(message(error));
    }
  }, [onError]);
  useEffect(() => {
    void load();
  }, [load]);
  const run = async (which: "rescan" | "prices") => {
    setBusy(which);
    onError(null);
    try {
      if (which === "rescan") await rescanUsage();
      else setPrices(await updateUsagePrices());
      await load();
    } catch (error) {
      onError(message(error));
    } finally {
      setBusy(null);
    }
  };
  return (
    <DesktopSettingsSection title="Logs and prices">
      {sources === null ? (
        <SkeletonList leading="icon" label="Logs" rows={3} lines={1} trailing />
      ) : (
        sources.map((source) => (
          <DesktopSettingsRow
            key={source.engine}
            label={source.label}
            description={source.roots.join(", ")}
            muted={source.status !== "ok"}
          >
            <span className="text-sm tabular-nums text-cream-muted">
              {source.status === "ok"
                ? `${source.files.toLocaleString("en-US")} ${source.files === 1 ? "log" : "logs"}`
                : sourceStatus[source.status]}
            </span>
          </DesktopSettingsRow>
        ))
      )}
      <DesktopSettingsRow label="Read every log again">
        <Button type="button" disabled={busy !== null} onClick={() => void run("rescan")}>
          Read again
        </Button>
      </DesktopSettingsRow>
      <DesktopSettingsRow
        label="Price table"
        description={
          prices
            ? `LiteLLM's prices from ${prices.snapshotDate}, ${prices.models.toLocaleString("en-US")} models`
            : undefined
        }
      >
        <Button type="button" disabled={busy !== null} onClick={() => void run("prices")}>
          Update prices
        </Button>
      </DesktopSettingsRow>
    </DesktopSettingsSection>
  );
}
