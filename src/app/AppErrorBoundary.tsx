import { Component, type ReactNode } from "react";

/** The last line under the whole app: an error nothing else caught. Nothing is reported. */
export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
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
