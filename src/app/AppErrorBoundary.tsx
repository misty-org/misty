import { Surface, Text } from "@misty/ui";
import { Component, type ReactNode } from "react";

export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <Surface as="main" tone="page" role="alert" className="grid min-h-dvh place-items-center p-8">
        <Text bare tone="default">
          Misty encountered an unexpected error. Please restart the app.
        </Text>
      </Surface>
    ) : (
      this.props.children
    );
  }
}
