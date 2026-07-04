import type { ReactNode } from "react";

interface AuthShellProps {
  title: string;
  description?: string;
  children: ReactNode;
}

export default function AuthShell({ title, description, children }: AuthShellProps) {
  return (
    <div className="relative min-h-[calc(100vh-4rem)] overflow-hidden px-4 sm:px-5 py-10 sm:py-14">
      <div className="relative mx-auto flex max-w-md flex-col items-center pt-6 sm:pt-10">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-semibold tracking-tight text-text sm:text-4xl">
            {title}
          </h1>
          {description ? (
            <p className="mt-3 text-sm leading-6 text-text-muted sm:text-base">
              {description}
            </p>
          ) : null}
        </div>

        <div className="w-full">{children}</div>
      </div>
    </div>
  );
}
