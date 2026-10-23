import { useEffect, useState, type ReactNode } from "react";

/**
 * Mounts background helpers after the window has painted and the app is idle, so the shell and
 * the first page are never waiting on work nobody is looking at yet.
 */
export function DeferUntilIdle(props: { children: ReactNode; timeout?: number }) {
  const [ready, setReady] = useState(false);
  const { timeout = 2000 } = props;
  useEffect(() => {
    if (ready) return;
    const reveal = () => setReady(true);
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(reveal, { timeout });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(reveal, 300);
    return () => window.clearTimeout(id);
  }, [ready, timeout]);
  return ready ? <>{props.children}</> : null;
}
