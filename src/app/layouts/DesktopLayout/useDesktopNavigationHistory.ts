import { useEffect, useMemo, useState } from "react";
import type { Location, NavigateFunction, NavigationType } from "react-router-dom";

export interface DesktopNavigationHistoryState {
  currentIndex: number;
  furthestIndex: number;
}

function browserHistoryIndex(): number {
  const index = window.history.state?.idx;
  return typeof index === "number" && Number.isFinite(index) ? index : 0;
}

export function updateDesktopNavigationHistory(
  current: DesktopNavigationHistoryState,
  nextIndex: number,
  navigationType: NavigationType,
): DesktopNavigationHistoryState {
  if (navigationType === "PUSH") {
    return { currentIndex: nextIndex, furthestIndex: nextIndex };
  }
  return {
    currentIndex: nextIndex,
    furthestIndex: Math.max(current.furthestIndex, nextIndex),
  };
}

export function relativeDesktopHistoryIndex(baseIndex: number, browserIndex: number): number {
  if (!Number.isFinite(baseIndex) || !Number.isFinite(browserIndex)) return 0;
  return Math.max(0, browserIndex - baseIndex);
}

export function useDesktopNavigationHistory(params: {
  location: Location;
  navigate: NavigateFunction;
  navigationType: NavigationType;
}) {
  const initialIndex = useMemo(browserHistoryIndex, []);
  const [history, setHistory] = useState<DesktopNavigationHistoryState>({
    currentIndex: 0,
    furthestIndex: 0,
  });

  useEffect(() => {
    // React Router's history index belongs to the whole browser session. Treat
    // the entry Misty mounted on as zero so Back never escapes the application.
    const nextIndex = relativeDesktopHistoryIndex(initialIndex, browserHistoryIndex());
    setHistory((current) =>
      updateDesktopNavigationHistory(current, nextIndex, params.navigationType),
    );
  }, [initialIndex, params.location.key, params.navigationType]);

  const canGoBack = history.currentIndex > 0;
  const canGoForward = history.currentIndex < history.furthestIndex;

  return {
    canGoBack,
    canGoForward,
    goBack: () => {
      if (canGoBack) params.navigate(-1);
    },
    goForward: () => {
      if (canGoForward) params.navigate(1);
    },
  };
}
