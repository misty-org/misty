import { Component, type ReactNode } from "react";
import { ErrorState } from "@/shared/ui";

/**
 * When the room can't be drawn (no WebGL, or the scene threw), say so and offer to try again,
 * instead of leaving a placeholder that never fills in.
 */
export class SceneBoundary extends Component<
  { children: ReactNode; onRetry(): void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <ErrorState
        title="Couldn't draw the studio"
        line="This computer's graphics didn't start. Try again, or restart Misty."
        action={{
          label: "Try again",
          onClick: () => {
            this.setState({ failed: false });
            this.props.onRetry();
          },
        }}
      />
    );
  }
}

/** Whether this web view can draw with WebGL at all; asked once. */
let webgl: boolean | undefined;
export function canDrawRoom(): boolean {
  if (webgl === undefined) {
    try {
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      webgl = Boolean(context);
      // Web views allow only a few live contexts; this one was only a question.
      context?.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
      webgl = false;
    }
  }
  return webgl;
}
