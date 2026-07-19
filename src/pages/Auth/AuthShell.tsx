import type { ReactNode } from "react";

interface AuthShellProps {
  title: string;
  description?: string;
  children: ReactNode;
}

export default function AuthShell({ title, description, children }: AuthShellProps) {
  return (
    <section
      aria-labelledby="auth-page-title"
      className="relative min-h-[calc(100vh-4rem)] overflow-hidden bg-background px-4 py-10 text-foreground sm:px-5 sm:py-14"
    >
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-16 h-56 w-56 -translate-x-1/2 rounded-full bg-foreground/[0.04] blur-3xl" />
        <div className="radial-glow absolute inset-0" />
      </div>

      <div className="relative mx-auto flex max-w-md flex-col items-center pt-6 sm:pt-10">
        <div className="mb-8 text-center">
          <h1
            id="auth-page-title"
            className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl"
          >
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
    </section>
  );
}
