import { useLayoutEffect, useRef, useState, type ComponentPropsWithoutRef } from "react";
import { cn } from "./utils";

const overflowFadeClass = [
  "[mask-image:linear-gradient(to_right,black_calc(100%-18px),transparent)]",
  "[-webkit-mask-image:linear-gradient(to_right,black_calc(100%-18px),transparent)]",
].join(" ");

export function OverflowFadeText({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<"span">) {
  const textRef = useRef<HTMLSpanElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  useLayoutEffect(() => {
    const element = textRef.current;
    if (!element) return;

    const updateOverflow = () => {
      const nextIsOverflowing = element.scrollWidth > element.clientWidth + 1;
      setIsOverflowing((current) => (current === nextIsOverflowing ? current : nextIsOverflowing));
    };

    updateOverflow();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateOverflow);
    if (observer) observer.observe(element);
    else window.addEventListener("resize", updateOverflow);

    return () => {
      if (observer) observer.disconnect();
      else window.removeEventListener("resize", updateOverflow);
    };
  }, [children]);

  return (
    <span
      {...props}
      ref={textRef}
      className={cn(className, isOverflowing && overflowFadeClass)}
      data-text-overflowing={isOverflowing ? "true" : "false"}
    >
      {children}
    </span>
  );
}
