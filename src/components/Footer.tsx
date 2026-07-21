import { ArrowUpRight } from "lucide-react";
import { NavLink } from "react-router";

import { Separator } from "@/components/ui/separator";
import {
  BETA_ACCESS_EXTERNAL,
  BETA_ACCESS_HREF,
  PUBLIC_RELEASES_URL,
} from "@/lib/site";

const columns = [
  {
    label: "Product",
    links: [
      { to: "/features", text: "Features" },
      { to: "/pricing", text: "Pricing" },
      { to: "/download", text: "Download" },
    ],
  },
  {
    label: "Updates",
    links: [
      { to: "/roadmap", text: "Roadmap" },
      { to: "/changelog", text: "Changelog" },
      { to: "/blog", text: "Blog" },
    ],
  },
  {
    label: "Access",
    links: [
      { to: BETA_ACCESS_HREF, text: "Request beta access", external: BETA_ACCESS_EXTERNAL },
      { to: "/signin", text: "Sign in" },
      { to: PUBLIC_RELEASES_URL, text: "Public releases", external: true },
    ],
  },
];

const linkClass =
  "w-fit rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export default function Footer() {
  return (
    <footer className="relative z-10 border-t border-border bg-background px-5 py-12 sm:px-8 lg:px-12">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col justify-between gap-10 md:flex-row md:items-start">
          <div className="max-w-sm">
            <NavLink
              to="/"
              aria-label="Misty footer"
              className="flex w-fit items-center gap-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <img src="/misty_full.png" alt="" className="size-12" />
              <span className="text-base font-semibold tracking-tight text-foreground">Misty</span>
            </NavLink>
            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              Spaces for members, chat, tasks, and shared files.
            </p>
            <p className="mt-3 text-xs text-muted-foreground">Invite-only beta.</p>
          </div>

          <div className="grid grid-cols-2 gap-x-10 gap-y-8 sm:grid-cols-3 sm:gap-x-16">
            {columns.map((column) => (
              <div key={column.label} className="flex flex-col gap-3">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-foreground">
                  {column.label}
                </span>
                {column.links.map((link) =>
                  link.external ? (
                    <a
                      key={link.text}
                      href={link.to}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`${linkClass} inline-flex items-center gap-1`}
                    >
                      {link.text}
                      <ArrowUpRight className="size-3" aria-hidden="true" />
                    </a>
                  ) : (
                    <NavLink key={link.text} to={link.to} className={linkClass}>
                      {link.text}
                    </NavLink>
                  ),
                )}
              </div>
            ))}
          </div>
        </div>

        <Separator className="mt-12" />
        <div className="flex flex-col gap-2 pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>&copy; {new Date().getFullYear()} Misty. All rights reserved.</span>
          <span>Invite-only beta.</span>
        </div>
      </div>
    </footer>
  );
}
