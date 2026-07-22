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
      className="min-h-[calc(100vh-4rem)] bg-background px-6 pb-24 pt-28 text-foreground sm:px-10 sm:pt-32 lg:px-16"
    >
      <div className="mx-auto grid w-full max-w-[1280px] gap-10 lg:grid-cols-[minmax(0,1fr)_28rem] lg:items-start lg:gap-20">
        <div className="max-w-2xl border-t border-border pt-8">
          <h1
            id="auth-page-title"
            className="text-balance text-4xl font-medium leading-[1.04] tracking-[-0.045em] text-foreground sm:text-5xl"
          >
            {title}
          </h1>
          {description ? (
            <p className="mt-5 max-w-lg text-base leading-7 text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>

        <div className="w-full">{children}</div>
      </div>
    </section>
  );
}
