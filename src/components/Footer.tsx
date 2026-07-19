import { NavLink } from "react-router";
import { FaDiscord, FaGithub } from "react-icons/fa";
import { MdOutlineEmail } from "react-icons/md";
import { Separator } from "@/components/ui/separator";

const columns = [
  {
    label: "Product",
    links: [
      { to: "/download", text: "Download" },
      { to: "/changelog", text: "Changelog" },
    ],
  },
  {
    label: "Resources",
    links: [
      { to: "/features", text: "Features" },
      { to: "/roadmap", text: "Roadmap" },
    ],
  },
  {
    label: "Support",
    links: [
      { to: "https://forms.gle/your-form-id", text: "Submit a Ticket", external: true },
      { to: "https://discord.gg/M3EQuWcFS", text: "Discord Community", external: true },
      { to: "mailto:hello@misty.app", text: "Contact", external: true },
    ],
  },
];

const socials = [
  { href: "https://discord.gg/M3EQuWcFS", icon: FaDiscord, label: "Discord" },
  { href: "https://github.com/misty-org/misty-public", icon: FaGithub, label: "GitHub" },
  { href: "mailto:hello@misty.app", icon: MdOutlineEmail, label: "Email" },
];

export default function Footer() {
  return (
    <footer className="border-t border-border py-12">
      <div className="flex flex-col md:flex-row justify-between items-start gap-8">
        {/* Brand */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-1">
            <img src="/misty_full.png" alt="" className="size-12 opacity-70" />
            <span className="text-sm font-medium text-foreground">Misty</span>
          </div>
          <p className="max-w-xs text-sm text-muted-foreground">
            A unified desktop workspace for local files, cloud storage, search, and transfers.
          </p>
          <div className="flex items-center gap-4 mt-2">
            {socials.map(({ href, icon: Icon, label }) => (
              <a key={label} href={href} target="_blank" rel="noopener noreferrer" className="rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={label}>
                <Icon className="size-4" />
              </a>
            ))}
          </div>
        </div>

        {/* Link Columns */}
        <div className="grid w-full grid-cols-2 gap-x-8 gap-y-8 sm:w-auto sm:grid-cols-3 sm:gap-x-16">
          {columns.map((col) => (
            <div key={col.label} className="flex flex-col gap-3 last:col-span-2 sm:last:col-span-1">
              <span className="text-xs font-medium tracking-[0.14em] text-foreground">{col.label}</span>
              {col.links.map((link) =>
                link.to.startsWith("http") || link.to.startsWith("mailto") ? (
                  <a key={link.text} href={link.to} target="_blank" rel="noopener noreferrer" className="rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{link.text}</a>
                ) : (
                  <NavLink key={link.text} to={link.to} className="rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{link.text}</NavLink>
                )
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Bottom */}
      <Separator className="mt-12" />
      <div className="flex flex-col items-center justify-between gap-4 pt-6 md:flex-row">
        <span className="text-xs text-muted-foreground">&copy; {new Date().getFullYear()} Misty. All rights reserved.</span>
        <div className="flex items-center gap-6">
          <NavLink to="/privacy" className="rounded-sm text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Privacy Policy</NavLink>
          <NavLink to="/terms" className="rounded-sm text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Terms of Service</NavLink>
        </div>
      </div>
    </footer>
  );
}
