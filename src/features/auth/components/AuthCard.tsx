import type { ReactNode } from "react";

export default function AuthCard({ title, description, children, footer }: AuthCardProps) {
  return (
    <div className="w-full">
      {title || description ? (
        <div className="mb-6">
          {title ? <h2 className="text-lg font-medium text-cream">{title}</h2> : null}
          {description ? (
            <p className="mt-2 text-sm leading-6 text-cream-muted">{description}</p>
          ) : null}
        </div>
      ) : null}

      <div>{children}</div>

      {footer ? <div className="mt-7 border-t border-charcoal-border pt-6">{footer}</div> : null}
    </div>
  );
}

export interface AuthCardProps {
  title?: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}
