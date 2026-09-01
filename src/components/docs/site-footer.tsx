import { FaDiscord, FaGithub, FaInstagram, FaXTwitter, FaYoutube } from "react-icons/fa6";

const websiteOrigin = "https://mistysys.com";

const columns = [
  {
    label: "Explore",
    links: [
      { href: `${websiteOrigin}/#features`, label: "Features" },
      { href: `${websiteOrigin}/pricing`, label: "Pricing" },
      { href: `${websiteOrigin}/download`, label: "Download" },
      { href: `${websiteOrigin}/register`, label: "Join now" },
    ],
  },
  {
    label: "Resources",
    links: [
      { href: `${websiteOrigin}/blog`, label: "Blog" },
      { href: `${websiteOrigin}/roadmap`, label: "Roadmap" },
      { href: `${websiteOrigin}/changelog`, label: "Changelog" },
      { href: "https://github.com/misty-org/misty-public/releases", label: "Public releases" },
    ],
  },
];

const legalLinks = [
  { href: `${websiteOrigin}/privacy`, label: "Privacy" },
  { href: `${websiteOrigin}/terms`, label: "Terms" },
  { href: `${websiteOrigin}/license`, label: "License" },
];

const socialLinks = [
  { label: "GitHub", href: "https://github.com/misty-org", icon: FaGithub },
  { label: "X.com", icon: FaXTwitter },
  { label: "Discord", icon: FaDiscord },
  { label: "YouTube", icon: FaYoutube },
  { label: "Instagram", icon: FaInstagram },
];

function BrandLogo() {
  return <span aria-hidden="true" className="footer-brand-mark" />;
}

export function SiteFooter() {
  return (
    <footer className="docs-site-footer">
      <div className="footer-container">
        <div className="footer-main">
          <div>
            <a href={websiteOrigin} className="footer-brand" aria-label="Misty home">
              <BrandLogo />
              <span>Misty</span>
            </a>
            <div className="footer-socials" aria-label="Misty social links">
              {socialLinks.map(({ label, href, icon: Icon }) => href ? (
                <a key={label} href={href} target="_blank" rel="noopener noreferrer" aria-label={label}>
                  <Icon aria-hidden="true" />
                  <span>{label}</span>
                </a>
              ) : (
                <span key={label} className="footer-social-placeholder" aria-label={`${label} coming soon`}>
                  <Icon aria-hidden="true" />
                  <span>{label}</span>
                </span>
              ))}
            </div>
          </div>

          <div className="footer-columns">
            {columns.map((column) => (
              <nav key={column.label} aria-label={`${column.label} footer links`}>
                <h2>{column.label}</h2>
                {column.links.map((link) => (
                  <a key={link.href} href={link.href}>{link.label}</a>
                ))}
              </nav>
            ))}
          </div>
        </div>

        <div className="footer-legal">
          <span>&copy; {new Date().getFullYear()} Misty. All rights reserved.</span>
          <nav aria-label="Legal">
            {legalLinks.map((link) => <a key={link.href} href={link.href}>{link.label}</a>)}
          </nav>
        </div>
      </div>
    </footer>
  );
}
