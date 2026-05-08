import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui";
import { Activity, ArrowLeftRight, Bot, Database, type LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { formatBytes, formatRelative } from "../homeFormat";
import type { HomeStatus } from "../useHomeStatus";

const rowClass = [
  "grid min-h-[52px] grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3",
  "border-b border-charcoal-border/60 px-5 py-2 transition-colors",
  "last:border-b-0 hover:bg-charcoal-hover/55",
].join(" ");

export function HomeStatusCard({ status }: { status: HomeStatus }) {
  const transferDetail = status.transfers.active
    ? `${status.transfers.active} active · ${formatBytes(status.transfers.transferredBytes)} of ${formatBytes(status.transfers.totalBytes)}`
    : status.transfers.failed
      ? `${status.transfers.failed} failed`
      : "Nothing transferring";

  const agentDetail = status.agents.unread
    ? `${status.agents.unread} new update${status.agents.unread === 1 ? "" : "s"}`
    : status.agents.total
      ? `${status.agents.total} agent${status.agents.total === 1 ? "" : "s"} · nothing new`
      : "No agents yet";

  const indexDetail = status.index.scanning
    ? "Checking for new files…"
    : status.index.itemCount
      ? `${status.index.itemCount.toLocaleString()} items${
          status.index.lastScanTimeMs
            ? ` · checked ${formatRelative(status.index.lastScanTimeMs)}`
            : ""
        }`
      : "Not indexed yet";

  return (
    <Card className="gap-0 bg-charcoal-card/70 py-0">
      <CardHeader className="flex flex-row items-center justify-between border-b border-charcoal-border/70 px-5 py-4">
        <CardTitle className="text-base font-semibold text-cream-bright">Status</CardTitle>
        <Activity className="size-4 text-cream-muted" strokeWidth={1.8} />
      </CardHeader>
      <CardContent className="px-0">
        <StatusRow
          icon={ArrowLeftRight}
          label="Transfers"
          detail={transferDetail}
          to="/transfers"
          progress={
            status.transfers.totalBytes
              ? status.transfers.transferredBytes / status.transfers.totalBytes
              : null
          }
        />
        <StatusRow icon={Bot} label="Agents" detail={agentDetail} to="/agents" />
        <StatusRow icon={Database} label="Search index" detail={indexDetail} to="/files" />
      </CardContent>
    </Card>
  );
}

function StatusRow(props: {
  icon: LucideIcon;
  label: string;
  detail: string;
  to: string;
  progress?: number | null;
}) {
  const Icon = props.icon;
  return (
    <Link to={props.to} className={rowClass}>
      <span className="grid size-7 place-items-center rounded-md bg-charcoal-bg text-cream-muted">
        <Icon className="size-4" strokeWidth={1.8} />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-cream">{props.label}</span>
        <span className="block truncate text-xs text-cream-muted">{props.detail}</span>
        {typeof props.progress === "number" ? (
          <span className="mt-1.5 block h-1 w-full overflow-hidden rounded-full bg-charcoal-hover">
            <span
              className="block h-full rounded-full bg-sage-fg transition-[width]"
              style={{ width: `${Math.round(Math.min(1, Math.max(0, props.progress)) * 100)}%` }}
            />
          </span>
        ) : null}
      </span>
    </Link>
  );
}
