import type { ReactNode } from "react";

interface AuthCardProps {
  title?: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}

export default function AuthCard({ title, description, children, footer }: AuthCardProps) {
  return (
    <section className="glass-card rounded-[2rem] border border-white/8 bg-[#090b0d]/95 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.45)] sm:p-8">
      {title || description ? (
        <div className="mb-7">
          {title ? <h2 className="text-2xl font-semibold text-text">{title}</h2> : null}
          {description ? (
            <p className="mt-2 text-sm leading-6 text-text-muted">{description}</p>
          ) : null}
        </div>
      ) : null}

      {children}

      {footer ? <div className="mt-6 border-t border-white/8 pt-6">{footer}</div> : null}
    </section>
  );
}
