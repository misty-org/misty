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

export function useDesktopNavigationHistory(params: {
  location: Location;
  navigate: NavigateFunction;
  navigationType: NavigationType;
}) {
  const initialIndex = useMemo(browserHistoryIndex, []);
  const [history, setHistory] = useState<DesktopNavigationHistoryState>({
    currentIndex: initialIndex,
    furthestIndex: initialIndex,
  });

  useEffect(() => {
    const nextIndex = browserHistoryIndex();
    setHistory((current) =>
      updateDesktopNavigationHistory(current, nextIndex, params.navigationType),
    );
  }, [params.location.key, params.navigationType]);

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
