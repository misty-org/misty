import { NavLink } from "react-router";

import { marketingCopy } from "@/content/marketingCopy";
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

const linkClass = "w-fit text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export default function Footer() {
  return (
    <footer className="relative z-10 border-t border-border bg-background">
      <div className="mx-auto max-w-[1280px] px-6 py-14 sm:px-10 lg:px-16">
        <div className="grid gap-12 border-b border-border pb-14 md:grid-cols-[1fr_auto] md:gap-20">
          <div className="max-w-xs">
            <NavLink
              to="/"
              aria-label="Misty footer"
              className="w-fit text-lg font-semibold tracking-[-0.025em] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Misty
            </NavLink>
            <p className="mt-4 text-sm leading-6 text-muted-foreground">{marketingCopy.home.proof}</p>
          </div>

          <div className="grid grid-cols-2 gap-x-12 gap-y-10 sm:grid-cols-3 sm:gap-x-20">
            {columns.map((column) => (
              <div key={column.label} className="flex flex-col gap-3">
                <span className="text-sm font-medium text-foreground">
                  {column.label}
                </span>
                {column.links.map((link) =>
                  link.external ? (
                    <a
                      key={link.text}
                      href={link.to}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={linkClass}
                    >
                      {link.text}
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

        <div className="pt-6 text-xs text-muted-foreground">
          <span>&copy; {new Date().getFullYear()} Misty. All rights reserved.</span>
        </div>
      </div>
    </footer>
  );
}
