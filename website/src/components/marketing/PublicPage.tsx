import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export const publicPageContainer =
  "mx-auto w-full max-w-[1280px] px-8 sm:px-16 lg:px-28";

export function PublicPage({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(publicPageContainer, "pb-24 pt-28 sm:pt-32", className)}>
      {children}
    </div>
  );
}
