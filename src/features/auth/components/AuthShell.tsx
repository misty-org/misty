import type { AuthShellProps } from "@/models/interfaces/features/auth/components/AuthShell";
export type { AuthShellProps } from "@/models/interfaces/features/auth/components/AuthShell";
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/ui";

export default function AuthShell({ title, description, children, onBack }: AuthShellProps) {
  return (
    <div className="relative min-h-[calc(100vh-4rem)] overflow-hidden px-4 sm:px-5 py-10 sm:py-14">
      {onBack ? (
        <Button
          className="absolute left-5 top-5 z-10 sm:left-7 sm:top-7"
          size="icon"
          variant="outline"
          type="button"
          aria-label="Back"
          title="Back"
          onClick={onBack}
        >
          <ArrowLeft size={20} strokeWidth={1.9} />
        </Button>
      ) : null}
      <div className="relative mx-auto flex max-w-md flex-col items-center pt-6 sm:pt-10">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            {title}
          </h1>
          {description ? (
            <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base">
              {description}
            </p>
          ) : null}
        </div>

        <div className="w-full">{children}</div>
      </div>
    </div>
  );
}
