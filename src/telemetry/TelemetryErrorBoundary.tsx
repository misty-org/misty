import { Component, type ErrorInfo, type ReactNode } from "react";
import { analytics } from "./client";

export class TelemetryErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, _info: ErrorInfo) {
    analytics.captureException(error, { operation: "unknown", runtime_layer: "react" });
  }
  render() {
    return this.state.failed ? (
      <main
        role="alert"
        className="grid min-h-dvh place-items-center bg-charcoal-bg p-8 text-cream"
      >
        Misty encountered an unexpected error. Please restart the app.
      </main>
    ) : (
      this.props.children
    );
  }
}
