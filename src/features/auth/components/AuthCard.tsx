import type { ReactNode } from "react";

export default function AuthCard({ title, description, children, footer }: AuthCardProps) {
  return (
    <div className="w-full rounded-xl border border-charcoal-border bg-window-chrome p-5">
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
        <div className="mt-4 flex justify-center border-t border-charcoal-border pt-4">
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
