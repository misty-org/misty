import type { ReactNode } from "react";

export default function AuthCard({ title, description, children, footer }: AuthCardProps) {
  return (
    <div className="w-full rounded-xl border border-charcoal-border bg-charcoal-card p-6 shadow-xl sm:p-8">
      {title || description ? (
        <div className="mb-7">
          {title ? <h2 className="text-2xl font-semibold text-cream">{title}</h2> : null}
          {description ? (
            <p className="mt-2 text-sm leading-6 text-cream-muted">{description}</p>
          ) : null}
        </div>
      ) : null}

      <div>{children}</div>

      {footer ? (
        <div className="mt-6 flex justify-center border-t border-charcoal-border pt-6">
          {footer}
        </div>
      ) : null}
    </div>
  );
}

export interface AuthCardProps {
  title?: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}
