import type { ReactNode } from "react";
import { NavLink } from "react-router";

import { cn } from "@/lib/utils";

export const publicPageContainer =
  "mx-auto w-full max-w-[1280px] px-6 sm:px-10 lg:px-16";

export function PublicPage({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn(publicPageContainer, "pb-24 pt-28 sm:pt-32", className)}>{children}</div>;
}

export function PageHeader({
  label,
  title,
  description,
  action,
  className,
}: {
  label: string;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("grid gap-8 border-b border-border pb-12 md:grid-cols-[1fr_auto] md:items-end", className)}>
      <div className="max-w-3xl">
        <p className="mb-5 text-sm text-muted-foreground">{label}</p>
        <h1 className="text-balance text-4xl font-medium leading-[1.02] tracking-[-0.045em] text-foreground sm:text-5xl lg:text-6xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div>{action}</div> : null}
    </header>
  );
}

const resourceLinks = [
  { to: "/blog", label: "Blog" },
  { to: "/changelog", label: "Changelog" },
  { to: "/roadmap", label: "Roadmap" },
];

export function ResourceNav() {
  return (
    <nav aria-label="Resources" className="flex gap-6 border-b border-border">
      {resourceLinks.map((link) => (
        <NavLink
          key={link.to}
          to={link.to}
          className={({ isActive }) =>
            cn(
              "border-b py-4 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isActive ? "border-foreground text-foreground" : "border-transparent",
            )
          }
        >
          {link.label}
        </NavLink>
      ))}
    </nav>
  );
}
