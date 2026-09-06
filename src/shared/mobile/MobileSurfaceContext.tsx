import type { LucideIcon } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefCallback,
} from "react";

export type SurfacePresentation = "desktop" | "mobile-compact" | "mobile-regular";

export interface MobileSurfaceAction {
  id: string;
  label: string;
  icon: LucideIcon;
  onPress: () => void;
  disabled?: boolean;
  badge?: number;
}

export interface MobileSurfaceChromeConfig {
  title: string;
  level: "root" | "detail";
  onBack?: () => void;
  primaryAction?: MobileSurfaceAction;
  overflowActions?: MobileSurfaceAction[];
}

interface MobileSurfaceContextValue {
  presentation: Exclude<SurfacePresentation, "desktop">;
  registerChrome: (owner: symbol, config: MobileSurfaceChromeConfig) => void;
  unregisterChrome: (owner: symbol) => void;
}

const MobileSurfaceContext = createContext<MobileSurfaceContextValue | null>(null);

export function MobileSurfaceProvider(props: {
  presentation: Exclude<SurfacePresentation, "desktop">;
  onChromeChange: (config: MobileSurfaceChromeConfig | null) => void;
  children: ReactNode;
}) {
  const { onChromeChange } = props;
  const registrations = useRef(new Map<symbol, MobileSurfaceChromeConfig>());

  const registerChrome = useCallback(
    (owner: symbol, config: MobileSurfaceChromeConfig) => {
      registrations.current.set(owner, config);
      onChromeChange(config);
    },
    [onChromeChange],
  );
  const unregisterChrome = useCallback(
    (owner: symbol) => {
      registrations.current.delete(owner);
      const remaining = [...registrations.current.values()];
      onChromeChange(remaining[remaining.length - 1] ?? null);
    },
    [onChromeChange],
  );

  const value = useMemo<MobileSurfaceContextValue>(
    () => ({ presentation: props.presentation, registerChrome, unregisterChrome }),
    [props.presentation, registerChrome, unregisterChrome],
  );
  return (
    <MobileSurfaceContext.Provider value={value}>{props.children}</MobileSurfaceContext.Provider>
  );
}

export function useSurfacePresentation(): SurfacePresentation {
  return useContext(MobileSurfaceContext)?.presentation ?? "desktop";
}

export function useMobileSurfaceChrome(config: MobileSurfaceChromeConfig | null): void {
  const context = useContext(MobileSurfaceContext);
  const owner = useRef(Symbol("mobile-surface-chrome"));
  const title = config?.title;
  const level = config?.level;
  const onBack = config?.onBack;
  const primaryAction = config?.primaryAction;
  const overflowActions = config?.overflowActions;
  const enabled = config !== null;

  useEffect(() => {
    if (!context || !enabled) return;
    const surfaceOwner = owner.current;
    context.registerChrome(surfaceOwner, {
      title: title ?? "Misty",
      level: level ?? "root",
      onBack,
      primaryAction,
      overflowActions,
    });
    return () => context.unregisterChrome(surfaceOwner);
  }, [context, enabled, level, onBack, overflowActions, primaryAction, title]);
}

export function useMobileStagePresentation(): {
  presentation: Exclude<SurfacePresentation, "desktop">;
  stageRef: RefCallback<HTMLElement>;
} {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [presentation, setPresentation] =
    useState<Exclude<SurfacePresentation, "desktop">>("mobile-compact");

  useEffect(() => {
    if (!node || typeof ResizeObserver === "undefined") return;
    const update = (width: number, height: number) =>
      setPresentation(width >= 720 && height >= 600 ? "mobile-regular" : "mobile-compact");
    update(node.clientWidth, node.clientHeight);
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      update(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);

  return { presentation, stageRef: setNode };
}
