// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { DesktopSettingsRow, DesktopSettingsSection } from "@/features/settings";
import { refreshCachedResource, useCachedResource } from "@/api/cache/cached-resource";
import { EngineMark } from "../EngineMark";
import { Button, cn, Progress, Skeleton, SkeletonControl, Text } from "@/shared/ui";
import { useCallback, useState } from "react";
import { type ProviderLimits } from "./usageApi";
import { engineName, formatReset, limitsStatusText, windowName } from "./usageFormat";
import { LIMITS_KEY, loadLimits, message, useNow, useReportError } from "./usageShared";

export function LimitsBlock(props: { onError: (error: string | null) => void }) {
  const { onError } = props;
  const saved = useCachedResource(LIMITS_KEY, () => loadLimits(false), { persist: "device" });
  const providers = saved.data;
  const [refreshing, setRefreshing] = useState(false);
  const now = useNow();
  useReportError(saved.error, onError);
  // Checking again asks the CLI afresh, keeping the last limits on screen until it answers.
  const checkAgain = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshCachedResource(LIMITS_KEY, () => loadLimits(true), "device");
    } catch (error) {
      onError(message(error));
    } finally {
      setRefreshing(false);
    }
  }, [onError]);
  return (
    <DesktopSettingsSection title="Plan limits">
      {providers === undefined ? (
        saved.loading ? (
          <ProviderRowsSkeleton />
        ) : null
      ) : (
        providers.map((limits) => (
          <ProviderRow
            key={limits.id}
            limits={limits}
            now={now}
            refreshing={refreshing}
            onRefresh={limits.id === "codex" ? () => void checkAgain() : undefined}
          />
        ))
      )}
    </DesktopSettingsSection>
  );
}

/**
 * The plan limits' first load: Claude's and Codex's rows, each with its name and status line,
 * two windows (a caption over a bar) and, for Codex, its Check again button.
 */
function ProviderRowsSkeleton() {
  return (
    <>
      {["w-32", "w-28"].map((width, index) => (
        <div
          key={width}
          data-setting-label=""
          role={index === 0 ? "status" : undefined}
          aria-label={index === 0 ? "Plan limits" : undefined}
          aria-busy={index === 0 || undefined}
          className="grid min-h-14 grid-cols-1 items-center gap-y-3 py-3"
        >
          <div className="grid min-w-0 gap-1">
            <div className="flex h-6 items-center">
              <Skeleton className={cn("h-4", width)} />
            </div>
            <div className="flex h-6 items-center">
              <Skeleton className="h-3.5 w-1/2" />
            </div>
          </div>
          <div className="grid w-full gap-3">
            {[0, 1].map((window) => (
              <div key={window} className="grid gap-1.5">
                <div className="flex h-5 items-center">
                  <Skeleton className="h-3.5 w-full" />
                </div>
                <Skeleton className="h-2 w-full rounded-full" />
              </div>
            ))}
            {index === 1 ? (
              <div>
                <SkeletonControl kind="button" className="w-28" />
              </div>
            ) : null}
          </div>
        </div>
      ))}
    </>
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
                <Text bare tone="default" className="flex items-center gap-2">
                  <EngineMark engine={limits.id} size={12} />
                  {windowName(window)}
                  {window.status === "rejected" ? (
                    <Text bare tone="bright">
                      · Limit reached
                    </Text>
                  ) : null}
                </Text>
                <Text bare tone="muted" className="tabular-nums">
                  {Math.round(window.usedPercent)}% used{reset ? ` · ${reset}` : ""}
                </Text>
              </div>
              <Progress value={window.usedPercent} aria-label={`${windowName(window)} used`} />
            </div>
          );
        })}
        {limits.credits && (limits.credits.hasCredits || limits.credits.unlimited) ? (
          <Text bare tone="muted" className="text-sm">
            Credits:{" "}
            {limits.credits.unlimited ? "Unlimited" : (limits.credits.balance ?? "Available")}
          </Text>
        ) : null}
        {limits.usingOverage ? (
          <Text bare tone="muted" className="text-sm">
            Using extra usage beyond the plan
          </Text>
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
