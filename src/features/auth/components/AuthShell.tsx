import { Button } from "@/shared/ui";
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";

export default function AuthShell({ title, description, children, onBack }: AuthShellProps) {
  return (
    <div className="relative flex min-h-full flex-col overflow-y-auto bg-charcoal-bg px-4 pb-[max(6rem,env(safe-area-inset-bottom))] pt-[max(7rem,env(safe-area-inset-top))] sm:px-6 sm:pt-32">
      {onBack ? (
        <Button
          className="absolute left-4 top-[max(1rem,env(safe-area-inset-top))] z-10 text-cream-muted sm:left-7 sm:top-7"
          size="icon"
          variant="ghost"
          type="button"
          aria-label="Back"
          title="Back"
          onClick={onBack}
        >
          <ChevronLeft size={20} strokeWidth={1.9} />
        </Button>
      ) : null}

      <div className="mx-auto flex w-full max-w-md flex-col gap-8">
        <div className="text-center">
          <h1 className="text-balance text-3xl font-medium tracking-[-0.04em] text-cream sm:text-4xl">
            {title}
          </h1>
          {description ? (
            <p className="mt-3 text-sm leading-6 text-cream-muted sm:text-base">{description}</p>
          ) : null}
        </div>

        <div className="flex w-full flex-col">{children}</div>
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
