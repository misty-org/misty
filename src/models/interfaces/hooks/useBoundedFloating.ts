import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";

export interface UseBoundedFloatingOptions {
  open: boolean;
  anchorRef: RefObject<HTMLElement>;
  align?: "start" | "end";
  gap?: number;
  viewportPadding?: number;
  preferredMaxHeight?: number;
  minimumUsefulHeight?: number;
  matchAnchorWidth?: boolean;
}

export interface BoundedFloatingResult {
  floatingRef: RefObject<HTMLDivElement | null>;
  floatingStyle: CSSProperties;
  opensAbove: boolean;
}
