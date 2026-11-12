import { routes } from "@/app/shell";
import { MistyBrandIcon } from "@/features/app-windows";
import { IconButton, Pressable } from "@/shared/ui";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { ComponentType, SVGProps } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { DiscordMark, GithubMark, InstagramMark, XMark, YoutubeMark } from "./SocialMarks";

/** misty-website's navbar socials, with its icons and in its order. An account without a page
 * yet stays dimmed, so no button opens nothing; give it an `href` to turn it on. */
const socialAccounts: {
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  href?: string;
}[] = [
  { label: "GitHub", icon: GithubMark, href: "https://github.com/misty-org" },
  { label: "X", icon: XMark },
  // The community server the repository README links.
  { label: "Discord", icon: DiscordMark, href: "https://discord.gg/B5WgSw6uX" },
  { label: "YouTube", icon: YoutubeMark },
  { label: "Instagram", icon: InstagramMark },
];

/** The floating bar on every signed-out page: the logo, which goes to the welcome page, and the
 * socials. The route state goes along, so someone adding an account can still get back. */
export function WelcomeNav() {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <nav
      aria-label="Misty"
      className="absolute inset-x-4 top-1 z-10 mx-auto flex h-14 max-w-5xl items-center gap-2 rounded-2xl border border-charcoal-border px-4 sm:inset-x-8"
    >
      <Pressable
        aria-label="Misty home"
        className="flex items-center gap-2.5 rounded-lg px-1.5 py-1"
        onClick={() => navigate(routes.welcome, { state: location.state })}
      >
        <MistyBrandIcon size={26} aria-hidden />
        <span className="text-lg font-semibold tracking-[-0.02em] text-cream-bright">Misty</span>
      </Pressable>
      <div className="ml-auto flex items-center gap-0.5">
        {socialAccounts.map(({ label, icon: Icon, href }) => (
          <IconButton
            key={label}
            label={`Misty on ${label}`}
            disabled={!href}
            onClick={href ? () => void openUrl(href) : undefined}
          >
            <Icon aria-hidden="true" className="size-3.5" />
          </IconButton>
        ))}
      </div>
    </nav>
  );
}
