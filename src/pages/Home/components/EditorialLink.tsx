import { NavLink } from "react-router";

export function EditorialLink({
  to,
  children,
}: {
  to: string;
  children: string;
}) {
  return (
    <NavLink
      to={to}
      className="inline-flex w-fit border-b border-foreground pb-1 text-sm font-medium text-foreground transition-opacity hover:opacity-65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </NavLink>
  );
}
