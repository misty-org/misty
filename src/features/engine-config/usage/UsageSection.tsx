// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

import {
  DesktopSettingsNotice,
  DesktopSettingsRow,
  DesktopSettingsRowSkeleton,
} from "@/features/settings";
import { useCachedResource } from "@/api/cache/cached_resource";
import {
  Button,
  ChoiceGroup,
  cn,
  Mark,
  OverflowFadeText,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
  Tooltip,
} from "@misty/ui";
import { useEffect, useMemo, useState } from "react";
import {
  localDay,
  onUsageChanged,
  queryUsage,
  rescanUsage,
  updateUsagePrices,
  usagePrices,
  usageSources,
  type UsagePriceInfo,
  type UsageQueryResult,
  type UsageSource,
} from "./usage_api";
import {
  dailyTotals,
  engineName,
  folderLabel,
  formatCost,
  formatTokens,
  groupRows,
  type UsageGroup,
} from "./usage_format";
import { LimitsBlock } from "./UsageLimits";
import { message, useReportError } from "./usage_shared";

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

function rangeDates(days: number) {
  const to = new Date();
  const from = new Date(to.getTime() - (days - 1) * 86_400_000);
  return { from: localDay(from), to: localDay(to) };
}

const SOURCES_KEY = "engine-config/usage-sources";
const usageKey = (range: Range) => `engine-config/usage:${range}`;

function useBlockError() {
  const [error, setError] = useState<string | null>(null);
  return {
    notice: error ? <DesktopSettingsNotice>{error}</DesktopSettingsNotice> : null,
    onError: setError,
  };
}

export function UsageSection() {
  const { notice, onError } = useBlockError();
  return (
    <>
      {notice}
      <UsageBlock onError={onError} />
    </>
  );
}

export function UsageLimitsSection() {
  const { notice, onError } = useBlockError();
  return (
    <>
      {notice}
      <LimitsBlock onError={onError} />
    </>
  );
}

export function UsageLogsSection() {
  const { notice, onError } = useBlockError();
  return (
    <>
      {notice}
      <SourcesBlock onError={onError} />
    </>
  );
}

function UsageBlock(props: { onError: (error: string | null) => void }) {
  const { onError } = props;
  const [range, setRange] = useState<Range>("7");
  const [group, setGroup] = useState<UsageGroup>("engine");
  const dates = useMemo(() => rangeDates(Number(range)), [range]);
  const usage = useCachedResource<UsageQueryResult>(
    usageKey(range),
    () => queryUsage({ ...rangeDates(Number(range)), bucket: "day" }),
    { persist: "device" },
  );
  const result = usage.data ?? null;
  const reloadUsage = usage.reload;
  useReportError(usage.error, onError);
  useEffect(() => onUsageChanged(() => void reloadUsage()), [reloadUsage]);
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
    <>
      <DesktopSettingsRow label="Range">
        <ChoiceGroup label="Range" value={range} options={ranges} onChange={setRange} />
      </DesktopSettingsRow>
      <DesktopSettingsRow label="Group by">
        <ChoiceGroup label="Group by" value={group} options={groups} onChange={setGroup} />
      </DesktopSettingsRow>
      {result === null ? (
        usage.loading ? (
          <UsageSkeleton />
        ) : null
      ) : (
        <DesktopSettingsRow label={`Last ${range} days`} stacked>
          <div className="grid w-full gap-4">
            <div className="flex min-w-0 gap-8">
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
                <Tooltip
                  key={day.day}
                  content={`${day.day}: ${formatTokens(day.tokens)} tokens, ${formatCost(day.cost)}`}
                >
                  <div className="flex h-full min-w-0 flex-1 items-end">
                    <Text
                      bare
                      as="div"
                      tone="muted"
                      className="w-full rounded-sm bg-current/50"
                      style={{
                        height: `${Math.max(day.tokens ? 2 : 0, (day.tokens / peak) * 100)}%`,
                      }}
                    />
                  </div>
                </Tooltip>
              ))}
            </div>
            {grouped.length === 0 ? (
              <Text size="meta" as="p" tone="muted">
                No usage in this range
              </Text>
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
                      <TableCell className="max-w-60 overflow-hidden">
                        <Tooltip content={entry.key}>
                          <span className="flex min-w-0 items-center gap-2">
                            {group === "engine" ? (
                              <Mark
                                of={`engine:${entry.key}`}
                                size={12}
                                label={engineName(entry.key)}
                                aria-hidden
                              />
                            ) : null}
                            <OverflowFadeText>
                              {group === "engine"
                                ? engineName(entry.key)
                                : group === "project"
                                  ? folderLabel(entry.key)
                                  : entry.key}
                            </OverflowFadeText>
                          </span>
                        </Tooltip>
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
        </DesktopSettingsRow>
      )}
    </>
  );
}

function UsageSkeleton() {
  return (
    <div role="status" aria-label="Usage" aria-busy="true" className="grid gap-4 px-3 py-3">
      <span className="sr-only">Usage</span>
      <div className="flex min-w-0 gap-8">
        {[0, 1, 2].map((figure) => (
          <div key={figure} className="grid gap-0.5">
            <div className="flex h-5 items-center">
              <Skeleton className="h-3.5 w-16" />
            </div>
            <div className="flex h-7 items-center">
              <Skeleton className="h-6 w-20" />
            </div>
          </div>
        ))}
      </div>
      <Skeleton className="h-28 w-full" />
      <div className="grid">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className={cn("flex h-8 items-center gap-4 px-2", row < 3 && "border-b")}>
            <Skeleton className={cn("h-3", row === 0 ? "w-16" : "w-1/3")} />
            <div className="ml-auto flex items-center gap-4">
              {[0, 1, 2, 3, 4].map((cell) => (
                <Skeleton key={cell} className="h-3 w-10" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Figure(props: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5">
      <Text size="meta" bare tone="muted">
        {props.label}
      </Text>
      <Text size="title" bare tone="bright" weight="semibold" className="tabular-nums">
        {props.value}
      </Text>
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
  const logs = useCachedResource<{ sources: UsageSource[]; prices: UsagePriceInfo }>(
    SOURCES_KEY,
    async () => {
      const [sources, prices] = await Promise.all([usageSources(), usagePrices()]);
      return { sources, prices };
    },
    { persist: "device" },
  );
  const sources = logs.data?.sources ?? null;
  const prices = logs.data?.prices ?? null;
  const [busy, setBusy] = useState<"rescan" | "prices" | null>(null);
  useReportError(logs.error, onError);
  const run = async (which: "rescan" | "prices") => {
    setBusy(which);
    onError(null);
    try {
      if (which === "rescan") await rescanUsage();
      else {
        const updated = await updateUsagePrices();
        logs.set((previous) => ({ sources: previous?.sources ?? [], prices: updated }));
      }
      await logs.reload();
    } catch (error) {
      onError(message(error));
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      {sources === null ? (
        logs.loading ? (
          <DesktopSettingsRowSkeleton label="Logs" rows={4} description control="text" />
        ) : null
      ) : (
        sources.map((source) => (
          <DesktopSettingsRow
            key={source.engine}
            label={source.label}
            description={source.roots.join(", ")}
            muted={source.status !== "ok"}
          >
            <Text size="meta" bare tone="muted" className="tabular-nums">
              {source.status === "ok"
                ? `${source.files.toLocaleString("en-US")} ${source.files === 1 ? "log" : "logs"}`
                : sourceStatus[source.status]}
            </Text>
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
    </>
  );
}
