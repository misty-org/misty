import { useEffect, useRef, useState } from "react";
import { Menu, Moon, Search, Sun, X } from "lucide-react";
import { FaDiscord, FaGithub, FaInstagram, FaXTwitter, FaYoutube } from "react-icons/fa6";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import { useTheme } from "@/components/theme-provider";

const websiteOrigin = "https://mistysys.com";
const socialLinks = [
  { label: "GitHub", href: "https://github.com/misty-org", icon: FaGithub },
  { label: "X.com", href: "#", icon: FaXTwitter, placeholder: true },
  { label: "Discord", href: "#", icon: FaDiscord, placeholder: true },
  { label: "YouTube", href: "#", icon: FaYoutube, placeholder: true },
  { label: "Instagram", href: "#", icon: FaInstagram, placeholder: true },
];

export function WebsiteNavbar({
  onOpenSearch,
  onOpenDocsMenu,
  docsMenuOpen,
}: {
  onOpenSearch: () => void;
  onOpenDocsMenu: () => void;
  docsMenuOpen: boolean;
}) {
  const { theme, toggleTheme } = useTheme();
  const [resourcesOpen, setResourcesOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const resourcesCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelResourcesClose = () => {
    if (resourcesCloseTimer.current) {
      clearTimeout(resourcesCloseTimer.current);
      resourcesCloseTimer.current = null;
    }
  };

  const openResources = () => {
    cancelResourcesClose();
    setResourcesOpen(true);
  };

  const scheduleResourcesClose = () => {
    cancelResourcesClose();
    resourcesCloseTimer.current = setTimeout(() => setResourcesOpen(false), 100);
  };

  useEffect(
    () => () => {
      if (resourcesCloseTimer.current) clearTimeout(resourcesCloseTimer.current);
    },
    [],
  );

  return (
    <header className="docs-navbar">
      <div className="navbar-width">
        <div className="navbar-surface">
          <div className="navbar-row">
            <div className="navbar-brand-context">
              <a href={websiteOrigin} className="navbar-brand" aria-label="Misty home">
                <span className="navbar-brand-mark" aria-hidden="true" />
                <span>Misty</span>
              </a>
              <span className="navbar-divider" />
              <span className="navbar-product" aria-label="Misty Docs">Docs</span>
            </div>

            <nav className="navbar-desktop" aria-label="Primary navigation">
              <a href={`${websiteOrigin}/download`}>Download</a>
              <a href={`${websiteOrigin}/pricing`}>Pricing</a>
              <DropdownMenuPrimitive.Root open={resourcesOpen} onOpenChange={setResourcesOpen} modal={false}>
                <DropdownMenuPrimitive.Trigger asChild>
                  <button
                    className="navbar-resources-trigger"
                    type="button"
                    onPointerEnter={openResources}
                    onPointerLeave={scheduleResourcesClose}
                  >
                    Resources
                  </button>
                </DropdownMenuPrimitive.Trigger>
                <DropdownMenuPrimitive.Portal>
                  <DropdownMenuPrimitive.Content
                    className="navbar-menu"
                    align="center"
                    sideOffset={0}
                    onPointerEnter={openResources}
                    onPointerLeave={scheduleResourcesClose}
                    onCloseAutoFocus={(event) => event.preventDefault()}
                  >
                    <DropdownMenuPrimitive.Item asChild><a href={`${websiteOrigin}/blog`}>Blog</a></DropdownMenuPrimitive.Item>
                    <DropdownMenuPrimitive.Item asChild><a href={`${websiteOrigin}/changelog`}>Changelog</a></DropdownMenuPrimitive.Item>
                    <DropdownMenuPrimitive.Item asChild><a href={`${websiteOrigin}/roadmap`}>Roadmap</a></DropdownMenuPrimitive.Item>
                  </DropdownMenuPrimitive.Content>
                </DropdownMenuPrimitive.Portal>
              </DropdownMenuPrimitive.Root>

              <span className="navbar-actions-divider" />
              <div className="navbar-socials" aria-label="Misty social links">
                {socialLinks.map(({ label, href, icon: Icon, placeholder }) => (
                  <a
                    className="navbar-icon-link"
                    key={label}
                    href={href}
                    target={placeholder ? undefined : "_blank"}
                    rel={placeholder ? undefined : "noopener noreferrer"}
                    aria-label={placeholder ? `${label} link placeholder` : label}
                    title={placeholder ? `Add Misty's ${label} URL` : `Misty on ${label}`}
                  >
                    <Icon aria-hidden="true" />
                  </a>
                ))}
              </div>
              <a className="navbar-signin" href={`${websiteOrigin}/signin`}>Sign in</a>
              <button className="navbar-icon-link" type="button" onClick={toggleTheme} aria-label={`Use ${theme === "dark" ? "light" : "dark"} theme`}>
                {theme === "dark" ? <Sun /> : <Moon />}
              </button>
            </nav>

            <div className="navbar-mobile-actions">
              <button type="button" onClick={onOpenSearch} aria-label="Search documentation"><Search /></button>
              <button type="button" onClick={toggleTheme} aria-label={`Use ${theme === "dark" ? "light" : "dark"} theme`}>
                {theme === "dark" ? <Sun /> : <Moon />}
              </button>
              <button type="button" onClick={() => setMobileOpen((open) => !open)} aria-label={mobileOpen ? "Close website navigation" : "Open website navigation"}>
                {mobileOpen ? <X /> : <Menu />}
              </button>
            </div>
          </div>

          {mobileOpen && (
            <nav className="navbar-mobile-menu" aria-label="Mobile primary navigation">
              <a href={`${websiteOrigin}/download`}>Download</a>
              <a href={`${websiteOrigin}/pricing`}>Pricing</a>
              <a href={`${websiteOrigin}/blog`}>Blog</a>
              <a href={`${websiteOrigin}/changelog`}>Changelog</a>
              <a href={`${websiteOrigin}/roadmap`}>Roadmap</a>
              <a href={`${websiteOrigin}/signin`}>Sign in</a>
              <button type="button" onClick={() => { setMobileOpen(false); onOpenDocsMenu(); }}>
                {docsMenuOpen ? "Close docs navigation" : "Browse documentation"}
              </button>
            </nav>
          )}
        </div>
      </div>
    </header>
  );
}
