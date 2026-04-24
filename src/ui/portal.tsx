import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function PortalToId({ children, targetId }: { children: ReactNode; targetId: string }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setTarget(document.getElementById(targetId));
  }, [targetId]);

  return target ? createPortal(children, target) : null;
}
