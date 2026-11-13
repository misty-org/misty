import type { ReactNode } from "react";
import { createPortal } from "react-dom";

/** Renders children into `container` (default: document.body), outside the parent's clipping. */
export function Portal({ children, container }: { children: ReactNode; container?: HTMLElement }) {
  return createPortal(children, container ?? document.body);
}
