import { Button } from "@/shared/ui";
import { Component, type ErrorInfo, type ReactNode } from "react";

export class RenderErrorBoundary extends Component<
  RenderErrorBoundaryProps,
  RenderErrorBoundaryState
> {
  state: RenderErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): RenderErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error("Workspace render failed", error, info.componentStack);
    }
    recoverFromHookOrderMismatch(error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <section className="grid h-full min-h-0 min-w-0 content-center justify-items-center gap-3 bg-charcoal-bg p-8 text-center text-cream">
        <h1 className="m-0 text-[22px] font-semibold">Workspace render failed</h1>
        <p className="m-0 max-w-[680px] text-cream-muted [overflow-wrap:anywhere]">
          {this.state.error.message}
        </p>
        <Button
          className="rounded-lg border border-charcoal-border bg-charcoal-card px-3 py-2 text-cream"
          type="button"
          onClick={() => {
            clearVolatileWorkspaceSnapshots();
            clearHookOrderRecoveryAttempt();
            if (typeof window !== "undefined") {
              window.location.reload();
              return;
            }
            this.setState({ error: null });
          }}
        >
          Try again
        </Button>
      </section>
    );
  }
}

const hookOrderRecoveryKey = "misty.renderRecovery.hookOrder.v1";
const explorerWorkspaceResetKey = "misty.explorer.resetWorkspaceOnNextLoad.v1";
const volatileWorkspaceSnapshotKeys = [
  "misty.explorer.fileTable.columnWidths",
  "misty.explorer.fileTable.columnOrder",
  "misty.providers.multipanel.v1",
  "misty.transfers.multipanel.v1",
  "misty.transfers.table.columnWidths",
  "misty.transfers.table.columnOrder",
];

function recoverFromHookOrderMismatch(error: Error): void {
  if (!isHookOrderMismatch(error) || typeof window === "undefined") return;
  try {
    if (window.sessionStorage.getItem(hookOrderRecoveryKey)) return;
    window.sessionStorage.setItem(hookOrderRecoveryKey, "1");
    window.localStorage.setItem(explorerWorkspaceResetKey, "1");
    clearVolatileWorkspaceSnapshots();
    window.location.reload();
  } catch {
    // The visible boundary still offers a manual retry if storage is unavailable.
  }
}

function isHookOrderMismatch(error: Error): boolean {
  return /Rendered (more|fewer) hooks than/i.test(error.message);
}

function clearVolatileWorkspaceSnapshots(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(explorerWorkspaceResetKey, "1");
    for (const key of volatileWorkspaceSnapshotKeys) {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Ignore storage failures; retry still remounts the route subtree.
  }
}

function clearHookOrderRecoveryAttempt(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(hookOrderRecoveryKey);
  } catch {
    // Ignore storage failures; retry still reloads the app where possible.
  }
}

export interface RenderErrorBoundaryProps {
  children: ReactNode;
}

export interface RenderErrorBoundaryState {
  error: Error | null;
}
