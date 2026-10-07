import { apiRequest, readApiSessionGeneration } from "@/api/client";
import { useEffect, useState } from "react";

type Estimate = {
  available: boolean;
  allowed: boolean;
  usage?: {
    command?: {
      estimated_units: number;
      estimated_percentage: number;
      maximum: number;
      maximum_percentage: number;
    };
  };
};

export type CommandEstimate = NonNullable<NonNullable<Estimate["usage"]>["command"]>;

/** Billing's debounced estimate for a draft; stale drafts and other accounts never show. */
export function useCommandUsageEstimate(text: string, model?: string) {
  const generation = readApiSessionGeneration();
  const key = `${generation}:${model ?? "default"}:${text}`;
  const [result, setResult] = useState<{ key: string; value?: Estimate; failed?: boolean }>();
  useEffect(() => {
    if (!text.trim()) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void apiRequest<Estimate>("/billing/estimate", {
        method: "POST",
        body: JSON.stringify({ text, model }),
        signal: controller.signal,
      })
        .then((value) => {
          if (!controller.signal.aborted && generation === readApiSessionGeneration())
            setResult({ key, value });
        })
        .catch(() => {
          if (!controller.signal.aborted && generation === readApiSessionGeneration())
            setResult({ key, failed: true });
        });
    }, 500);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [text, model, generation, key]);
  const current = text.trim() && result?.key === key ? result : undefined;
  return {
    drafting: Boolean(text.trim()),
    command: current?.value?.usage?.command,
    allowed: current?.value?.allowed ?? true,
    settled: Boolean(current),
  };
}

export function formatUsagePercent(value: number) {
  const format = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
  return value > 0 && value < 0.01 ? `<${format.format(0.01)}` : format.format(value);
}

/** What the estimate means; shared by the composer footer and the Agents control bar. */
export function CommandEstimateDetails({
  command,
  allowed,
}: {
  command: CommandEstimate;
  allowed: boolean;
}) {
  return (
    <div className="space-y-1 leading-relaxed">
      <p>
        {command.estimated_units.toLocaleString()} weighted tokens estimated;{" "}
        {command.maximum.toLocaleString()} maximum for the command.
      </p>
      <p>
        This previews your draft and one response. History, attachments, and tool steps can add
        usage. Execution checks the full context and stops before admitting work beyond the command
        ceiling.
      </p>
      <p>
        Weighted tokens account for the model and input/output rates. Unused reservations return to
        your account.
      </p>
      {!allowed && (
        <p className="text-cream-bright">
          This estimate exceeds the available budget. Shorten the request or wait for your allowance
          to reset.
        </p>
      )}
    </div>
  );
}

/** Billing owns the estimate and ceiling; this component only formats them. */
export function CommandUsageEstimate({ text, model }: { text: string; model?: string }) {
  const { drafting, command, allowed, settled } = useCommandUsageEstimate(text, model);
  const percent = formatUsagePercent;
  if (!drafting) return null;
  if (!command)
    return (
      <p className="text-xs text-cream-muted" role="status">
        {settled
          ? "Usage estimate unavailable. Billing checks your budget before running."
          : "Estimating usage…"}
      </p>
    );
  return (
    <details className="min-w-0 text-xs text-cream-muted">
      <summary className="cursor-pointer rounded-sm focus-visible:outline focus-visible:outline-1 focus-visible:outline-cream-muted">
        Draft estimate: {percent(command.estimated_percentage)}% of weekly AI · Command ceiling:{" "}
        {percent(command.maximum_percentage)}%
      </summary>
      <div className="mt-2">
        <CommandEstimateDetails command={command} allowed={allowed} />
      </div>
    </details>
  );
}
