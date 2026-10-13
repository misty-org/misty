import { WelcomeNav } from "@/features/welcome";
import type { ReactNode } from "react";
import { useFitToHeight } from "./useFitToHeight";

export default function AuthShell({ title, description, children, onBack }: AuthShellProps) {
  const { panelRef, containerRef, scale } = useFitToHeight<HTMLDivElement, HTMLDivElement>();
  return (
    <div
      ref={containerRef}
      className="relative flex h-full flex-col overflow-y-auto bg-window-chrome px-4 pb-8 pt-24 sm:px-6"
    >
      <WelcomeNav onBack={onBack} />
      <div ref={panelRef} style={{ zoom: scale }} className="mx-auto my-auto w-full max-w-sm">
        <div key={title} className="misty-page-in flex flex-col gap-5">
          <div className="text-center">
            <h1 className="text-balance text-2xl font-medium tracking-[-0.04em] text-cream sm:text-3xl">
              {title}
            </h1>
            {description ? (
              <p className="mt-3 text-sm leading-6 text-cream-muted sm:text-base">{description}</p>
            ) : null}
          </div>

          <div className="flex w-full flex-col">{children}</div>
        </div>
      </div>
    </div>
  );
}

export interface AuthShellProps {
  title: string;
  description?: string;
  children: ReactNode;
  onBack?: () => void;
}
