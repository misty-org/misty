import {
  Component,
  createElement,
  lazy,
  Suspense,
  type ComponentProps,
  type ComponentType,
  type ReactNode,
} from "react";
import { SetupState, type SetupStateProps } from "./SetupState";

/** Resets for the tools whose code failed to load, run by a Try again. */
const failedLoads = new Set<() => void>();
/** Errors that are a tool's code failing to load, as opposed to the tool failing once running. */
const loadErrors = new WeakSet<object>();

/**
 * `React.lazy` for a tool's code (an editor, the terminal, a canvas) that can load again: React
 * keeps a failed lazy load for good, so after a dropped download Try again would only fail again.
 * Render it inside `ToolSuspense`, whose Try again loads the code afresh.
 *
 * ```tsx
 * const EditorPane = lazyTool(() => import("./EditorPane"));
 * <ToolSuspense tool="code editor"><EditorPane … /></ToolSuspense>
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any component, as React.lazy takes
export function lazyTool<T extends ComponentType<any>>(
  load: () => Promise<{ default: T }>,
): ComponentType<ComponentProps<T>> {
  const attempt = () =>
    load().catch((error: unknown) => {
      failedLoads.add(reset);
      if (error && typeof error === "object") loadErrors.add(error);
      throw error;
    });
  let current = lazy(attempt);
  function reset() {
    current = lazy(attempt);
  }
  // lazyTool runs once at module level, so this is one component per tool, not one per render.
  // eslint-disable-next-line shared-ui/no-nested-component
  function LazyTool(props: ComponentProps<T>) {
    return createElement(current as ComponentType<ComponentProps<T>>, props);
  }
  return LazyTool;
}

type ToolSetupProps = Omit<SetupStateProps, "error" | "onRetry"> & {
  /**
   * What the setup line sits in while the tool isn't there, for a tool that keeps a set room (a
   * sketch's board, a preview's card): it wraps the setting-up and failed states, not the tool.
   */
  frame?(state: ReactNode): ReactNode;
};

class ToolBoundary extends Component<
  { setup: ToolSetupProps; children: ReactNode },
  { error: unknown }
> {
  state = { error: null as unknown };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  retry = () => {
    for (const reset of failedLoads) reset();
    failedLoads.clear();
    this.setState({ error: null });
  };
  render() {
    const { error } = this.state;
    if (error === null) return this.props.children;
    // Only the tool's code failing to arrive is this boundary's; anything else goes on up.
    if (!(error && typeof error === "object" && loadErrors.has(error))) throw error;
    const { frame = (state: ReactNode) => state, ...setup } = this.props.setup;
    return frame(
      <SetupState
        {...setup}
        error="Misty couldn't load it. Check the connection and try again."
        onRetry={this.retry}
      />,
    );
  }
}

/**
 * Where a tool's code (`lazyTool`) arrives: `SetupState` says the tool is setting up while it
 * loads, and if the code can't be fetched it says so with Try again, which fetches it afresh.
 * Takes `SetupState`'s props for how that line reads and sits.
 *
 * ```tsx
 * <ToolSuspense tool="terminal"><TerminalPanel … /></ToolSuspense>
 * ```
 */
export function ToolSuspense({ children, ...props }: ToolSetupProps & { children: ReactNode }) {
  const { frame = (state: ReactNode) => state, ...setup } = props;
  return (
    <ToolBoundary setup={props}>
      <Suspense fallback={frame(<SetupState {...setup} />)}>{children}</Suspense>
    </ToolBoundary>
  );
}
