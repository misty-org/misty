import { NavLink, useLocation } from "react-router";

import { BrandLogo } from "@/components/brand/BrandLogo";
import { columns, legalLinks, socialLinks } from "./footerLinks";

const linkClass =
  "w-fit text-sm leading-6 text-foreground transition-opacity hover:opacity-75 focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function FooterColumns() {
  return (
    <>
      {columns.map((column) => (
        <nav
          key={column.label}
          aria-label={`${column.label} footer links`}
          className="flex flex-col gap-1.5"
        >
          <h2 className="mb-1 text-sm font-medium text-muted-foreground">
            {column.label}
          </h2>
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
        </nav>
      ))}
    </>
  );
}

function FooterSocials() {
  return (
    <div className="mt-5 grid max-w-xs auto-rows-6 grid-cols-2 gap-x-5 gap-y-1">
      {socialLinks.map(({ label, href, icon: Icon, placeholder }) => (
        <a
          key={label}
          href={href}
          target={placeholder ? undefined : "_blank"}
          rel={placeholder ? undefined : "noopener noreferrer"}
          aria-label={placeholder ? `${label} link placeholder` : label}
          title={placeholder ? `Add Misty's ${label} URL` : `Misty on ${label}`}
          className="group grid h-6 w-fit grid-cols-[1.25rem_auto] items-center gap-2 text-sm leading-none text-foreground transition-opacity hover:opacity-75 focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Icon aria-hidden="true" className="size-4 justify-self-center" />
          <span className="leading-none">{label}</span>
        </a>
      ))}
    </div>
  );
}

export default function Footer() {
  const location = useLocation();

  return (
    <footer
      className={`relative z-10 border-t border-border bg-background${location.pathname === "/" ? " home-content-rail" : ""}`}
    >
      <div className="site-container py-6">
        <div className="px-1.5">
          <div className="grid gap-y-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-x-20">
            <div>
              <NavLink
                to="/"
                aria-label="Misty footer"
                className="flex w-fit items-center gap-2 text-lg font-semibold tracking-[-0.035em] text-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <BrandLogo />
                <span>Misty</span>
              </NavLink>
              <FooterSocials />
            </div>

            <div className="grid grid-cols-2 gap-x-12 sm:gap-x-20 lg:gap-x-24">
              <FooterColumns />
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-2 border-t border-border pt-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>
              &copy; {new Date().getFullYear()} Misty. All rights reserved.
            </span>
            <nav
              aria-label="Legal"
              className="flex flex-wrap items-center gap-x-5 gap-y-1"
            >
              {legalLinks.map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  className="text-foreground transition-opacity hover:opacity-75 focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {link.text}
                </NavLink>
              ))}
            </nav>
          </div>
        </div>
      </div>
    </footer>
  );
}
