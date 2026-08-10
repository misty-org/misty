import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export const publicPageContainer =
  "mx-auto w-full max-w-[1280px] px-6 sm:px-10 lg:px-16";

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
