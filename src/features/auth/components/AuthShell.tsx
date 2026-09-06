import { Button } from "@/shared/ui";
import { MistyBrandIcon } from "@/features/workspace/MistyBrandIcon";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

export default function AuthShell({ title, description, children, onBack }: AuthShellProps) {
  return (
    <div className="relative flex min-h-full flex-col overflow-y-auto bg-charcoal-bg px-6 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] sm:px-10 sm:pt-9">
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
          <ArrowLeft size={20} strokeWidth={1.9} />
        </Button>
      ) : null}
      <div className="flex items-center justify-center gap-2.5 text-sm font-medium text-cream-muted">
        <MistyBrandIcon size={22} />
        <span>Misty</span>
      </div>

      <div className="relative mx-auto my-auto flex w-full max-w-[430px] flex-col items-center py-12 sm:py-16">
        <div className="mb-9 text-center">
          <h1 className="text-[32px] font-semibold leading-tight tracking-tight text-cream sm:text-4xl">
            {title}
          </h1>
          {description ? (
            <p className="mx-auto mt-4 max-w-[390px] text-[15px] leading-6 text-cream-muted">
              {description}
            </p>
          ) : null}
        </div>

        <div className="w-full">{children}</div>
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
