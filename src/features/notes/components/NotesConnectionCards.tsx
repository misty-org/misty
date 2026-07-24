import { AlertTriangle, ArrowRight, Clock3 } from "lucide-react";
import { SiNotion } from "react-icons/si";
import type { NoteProviderStatus } from "@/models/types/features/notes/types";
import { Button, Card, StatusBadge, cn } from "@/ui";
import { providerStatusPresentation } from "./NoteSourceBadge";

/**
 * Shown wherever Notion content would be but the provider is not usable yet.
 * Reconnect and first-connect share one card — only the copy differs.
 */
export function NotionConnectCard(props: {
  status: NoteProviderStatus;
  busy: boolean;
  onConnect: () => void;
  className?: string;
}) {
  const reconnect = props.status === "needs_reconnect";

  return (
    <Card className={cn("border-border bg-card p-4 shadow-sm", props.className)}>
      <div className="flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-md border border-border bg-muted/50">
          <SiNotion size={15} color="#E16259" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-[13px] font-semibold text-foreground">Notion</h3>
            <StatusBadge status={providerStatusPresentation[props.status].tone}>
              {providerStatusPresentation[props.status].label}
            </StatusBadge>
          </div>
          <p className="mt-1.5 text-[12px] leading-[1.5] text-muted-foreground">
            {reconnect
              ? "Your Notion authorization expired. Reconnect to resume syncing pages into Misty."
              : "Connect Notion to search selected pages alongside Misty notes. Misty writes only when you explicitly publish."}
          </p>
          <div className="mt-3 flex items-center gap-2">
            <Button type="button" size="sm" disabled={props.busy} onClick={props.onConnect}>
              {props.busy ? "Connecting…" : reconnect ? "Reconnect Notion" : "Connect Notion"}
            </Button>
            <span className="text-[11px] text-muted-foreground/70">Explicit publishing only</span>
          </div>
        </div>
      </div>
    </Card>
  );
}

/** Calm by construction: amber, inline, and it never hides the cached content. */
export function SyncErrorNotice(props: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-start gap-2 border-b border-border/60 bg-amber-500/5 px-3 py-2.5">
      <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-500" />
      <p className="min-w-0 flex-1 text-[11px] leading-[1.5] text-muted-foreground">
        {props.message} <span className="text-muted-foreground/70">Cached notes still shown.</span>
      </p>
      {props.onRetry ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-5 shrink-0 px-1.5 text-[11px]"
          onClick={props.onRetry}
        >
          Retry
        </Button>
      ) : null}
    </div>
  );
}

/** Conflict framing: informational, never a blocking "resolve now" modal. */
export function ConflictNotice(props: { onOpenInSource: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2">
      <Clock3 size={13} className="shrink-0 text-primary" />
      <p className="min-w-0 flex-1 text-[11px] leading-[1.5] text-muted-foreground">
        This page changed in Notion after Misty last read it. You are seeing Misty&rsquo;s copy.
      </p>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-6 shrink-0 gap-1 px-2 text-[11px]"
        onClick={props.onOpenInSource}
      >
        View latest
        <ArrowRight size={11} />
      </Button>
    </div>
  );
}
