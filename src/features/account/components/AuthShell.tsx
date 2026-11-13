import { WelcomeNav } from "./WelcomeNav";
import type { ReactNode } from "react";
import { PageEnter, Text } from "@/shared/ui";
import { useFitToHeight } from "./useFitToHeight";

export default function AuthShell({ title, description, children }: AuthShellProps) {
  const { panelRef, containerRef, scale } = useFitToHeight<HTMLDivElement, HTMLDivElement>();
  return (
    <div
      ref={containerRef}
      className="relative flex h-full flex-col overflow-y-auto bg-window-chrome px-4 pb-6 pt-20 sm:px-6"
    >
      <WelcomeNav />
      <div ref={panelRef} style={{ zoom: scale }} className="mx-auto my-auto w-full max-w-md">
        <PageEnter key={title} className="flex flex-col gap-8">
          <div className="text-center">
            <Text
              bare
              as="h1"
              tone="default"
              className="text-balance text-2xl font-medium tracking-[-0.04em] sm:text-3xl"
            >
              {title}
            </Text>
            {description ? (
              <Text bare as="p" tone="muted" className="mt-3 text-sm leading-6 sm:text-base">
                {description}
              </Text>
            ) : null}
          </div>

          <div className="flex w-full flex-col">{children}</div>
        </PageEnter>
      </div>
    </div>
  );
}

interface AuthShellProps {
  title: string;
  description?: string;
  children: ReactNode;
}
