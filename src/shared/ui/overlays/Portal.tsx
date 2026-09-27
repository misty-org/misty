import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Renders children into `container` (default: document.body), outside the parent's clipping. */
export function Portal({ children, container }: { children: ReactNode; container?: HTMLElement }) {
  return createPortal(children, container ?? document.body);
}

/** Renders children into the element with `targetId` once it exists, e.g. a titlebar slot. */
export function PortalToId({ children, targetId }: { children: ReactNode; targetId: string }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setTarget(document.getElementById(targetId));
  }, [targetId]);

  return target ? createPortal(children, target) : null;
}
