import type { ReactNode } from "react";

export function DesktopSettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-7 min-w-0 last:mb-0">
      <div className="flex min-w-0 items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold leading-5 text-foreground">{title}</h2>
          {description ? (
            <p className="mt-1 max-w-2xl text-sm leading-5 text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
      </div>
      <div className="mt-4 overflow-hidden rounded-lg border border-border bg-card">
        {children}
      </div>
    </section>
  );
}
