import type { PropsWithChildren } from "react";

import { cn } from "@/lib/utils";

type ScrollStackSectionProps = PropsWithChildren<{
  className?: string;
  layer: number;
}>;

export default function ScrollStackSection({
  children,
  className,
  layer,
}: ScrollStackSectionProps) {
  return (
    <section
      className={cn(
        "relative flex min-h-[calc(100svh-4rem)] items-center rounded-t-[2rem] border-t border-border bg-background py-14 shadow-[0_-24px_60px_-36px_color-mix(in_oklab,var(--foreground)_24%,transparent)] md:sticky md:top-16 md:py-20",
        className,
      )}
      style={{ zIndex: layer }}
      data-scroll-stack-panel
    >
      <div className="w-full">{children}</div>
    </section>
  );
}
