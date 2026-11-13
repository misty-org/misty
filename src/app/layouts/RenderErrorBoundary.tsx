import { Button, cn, Surface, Text } from "@/shared/ui";
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
    if (this.props.scope !== "tab") recoverFromHookOrderMismatch(error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <Surface
        as="section"
        tone="page"
        className={cn(
          "grid h-full min-h-0 min-w-0 content-center justify-items-center gap-3 p-8",
          "text-center",
        )}
      >
        <Text bare as="h1" tone="default" className="m-0 text-xl font-semibold">
          {this.props.scope === "tab" ? "This tab could not be loaded" : "Workspace render failed"}
        </Text>
        <Text wrap tone="muted" className="m-0 max-w-170">
          {this.state.error.message}
        </Text>
        <Button
          variant="secondary"
          size="lg"
          onClick={() => {
            // A failed module request does not imply damaged workspace data.
            if (this.state.error && isHookOrderMismatch(this.state.error)) {
              clearVolatileWorkspaceSnapshots();
              clearHookOrderRecoveryAttempt();
            }
            if (typeof window !== "undefined") {
              window.location.reload();
              return;
            }
            this.setState({ error: null });
          }}
        >
          {this.props.scope === "tab" ? "Reload Misty" : "Try again"}
        </Button>
      </Surface>
    );
  }
}

const hookOrderRecoveryKey = "misty.renderRecovery.hookOrder.v1";
const explorerWorkspaceResetKey = "misty.explorer.resetWorkspaceOnNextLoad.v1";
const volatileWorkspaceSnapshotKeys = [
  "misty.explorer.fileTable.columnWidths",
  "misty.explorer.fileTable.columnOrder",
  "misty.providers.multipanel.v1",
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

interface RenderErrorBoundaryProps {
  children: ReactNode;
  scope?: "workspace" | "tab";
}

interface RenderErrorBoundaryState {
  error: Error | null;
}
