import { NavLink } from "react-router";
import { FaDiscord, FaGithub } from "react-icons/fa";
import { MdOutlineEmail } from "react-icons/md";

const columns = [
  {
    label: "Product",
    links: [
      { to: "/download", text: "Download" },
      { to: "/pricing", text: "Pricing" },
      { to: "/changelog", text: "Changelog" },
    ],
  },
  {
    label: "Resources",
    links: [
      { to: "/docs/getting-started", text: "Getting Started" },
      { to: "/docs/providers", text: "Cloud Providers" },
      { to: "/docs/self-hosting", text: "Self-Hosting" },
      { to: "/docs/api", text: "Api reference" },
    ],
  },
  {
    label: "Support",
    links: [
      { to: "https://forms.gle/your-form-id", text: "Submit a Ticket", external: true },
      { to: "https://discord.gg/your-invite", text: "Discord Community", external: true },
      { to: "mailto:hello@misty.app", text: "Contact", external: true },
    ],
  },
];

const socials = [
  { href: "https://discord.gg/your-invite", icon: FaDiscord, label: "Discord" },
  { href: "https://github.com/kannachi323", icon: FaGithub, label: "GitHub" },
  { href: "mailto:hello@misty.app", icon: MdOutlineEmail, label: "Email" },
];

export default function Footer() {
  return (
    <footer className="border-t border-border/50 py-12">
      <div className="flex flex-col md:flex-row justify-between items-start gap-8">
        {/* Brand */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-1">
            <img src="/misty_full.png" alt="Misty logo" className="w-12 h-12 opacity-60" />
            <span className="text-sm font-medium text-text-muted">Misty</span>
          </div>
          <p className="text-sm text-text-muted/60 max-w-xs">
            All your cloud files and devices in one place. Simple, private, and fast.
          </p>
          <div className="flex items-center gap-4 mt-2">
            {socials.map(({ href, icon: Icon, label }) => (
              <a key={label} href={href} target="_blank" rel="noopener noreferrer" className="text-text-muted/40 hover:text-text-muted transition-colors" aria-label={label}>
                <Icon className="w-4 h-4" />
              </a>
            ))}
          </div>
        </div>

        {/* Link Columns */}
        <div className="flex gap-12 sm:gap-16">
          {columns.map((col) => (
            <div key={col.label} className="flex flex-col gap-3">
              <span className="text-xs font-medium text-text-muted tracking-[0.14em]">{col.label}</span>
              {col.links.map((link) =>
                link.to.startsWith("http") || link.to.startsWith("mailto") ? (
                  <a key={link.text} href={link.to} target="_blank" rel="noopener noreferrer" className="text-sm text-text-muted/60 hover:text-text transition-colors">{link.text}</a>
                ) : (
                  <NavLink key={link.text} to={link.to} className="text-sm text-text-muted/60 hover:text-text transition-colors">{link.text}</NavLink>
                )
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Bottom */}
      <div className="mt-12 pt-6 border-t border-border/30 flex flex-col md:flex-row justify-between items-center gap-4">
        <span className="text-xs text-text-muted/40">&copy; {new Date().getFullYear()} Misty. All rights reserved.</span>
        <div className="flex items-center gap-6">
          <NavLink to="/privacy" className="text-xs text-text-muted/40 hover:text-text-muted transition-colors">Privacy Policy</NavLink>
          <NavLink to="/terms" className="text-xs text-text-muted/40 hover:text-text-muted transition-colors">Terms of Service</NavLink>
        </div>
      </div>
    </footer>
  );
}
