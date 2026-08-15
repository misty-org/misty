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
      <div className="mx-auto flex w-full max-w-md flex-col gap-8">
        <div className="text-center">
          <h1
            id="auth-page-title"
            className="text-balance text-3xl font-medium tracking-[-0.04em] text-foreground outline-none sm:text-4xl"
          >
            {title}
          </h1>
          {description ? (
            <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base">
              {description}
            </p>
          ) : null}
        </div>

        <div className="flex w-full flex-col">{children}</div>
      </div>
    </section>
  );
}
