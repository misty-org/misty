import { MistyBrandIcon } from "@/features/workspace";
import { IconButton, Pressable } from "@/shared/ui";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { IconType } from "react-icons";
import { FaDiscord, FaGithub, FaInstagram, FaXTwitter, FaYoutube } from "react-icons/fa6";

/** misty-website's navbar socials, with its icons; accounts without a page yet open nothing. */
const socialLinks: { label: string; icon: IconType; href?: string }[] = [
  { label: "GitHub", icon: FaGithub, href: "https://github.com/misty-org" },
  { label: "X", icon: FaXTwitter },
  { label: "Discord", icon: FaDiscord },
  { label: "YouTube", icon: FaYoutube },
  { label: "Instagram", icon: FaInstagram },
];

/** The floating bar on every signed-out page: the logo (which goes back when it can) and the socials. */
export function WelcomeNav({ onBack }: { onBack?: () => void }) {
  const brand = (
    <>
      <MistyBrandIcon size={26} aria-hidden />
      <span className="text-lg font-semibold tracking-[-0.02em] text-cream-bright">Misty</span>
    </>
  );
  return (
    <nav
      aria-label="Misty"
      className="absolute inset-x-4 top-10 z-10 mx-auto flex h-14 max-w-5xl items-center gap-2 rounded-2xl border border-charcoal-border px-4 sm:inset-x-8"
    >
      {onBack ? (
        <Pressable
          aria-label="Back"
          className="flex items-center gap-2.5 rounded-lg px-1.5 py-1"
          onClick={onBack}
        >
          {brand}
        </Pressable>
      ) : (
        <span className="flex items-center gap-2.5 px-1.5">{brand}</span>
      )}
      <div className="ml-auto flex items-center gap-0.5">
        {socialLinks.map(({ label, icon: Icon, href }) => (
          <IconButton
            key={label}
            size="sm"
            label={href ? `Misty on ${label}` : `${label} (coming soon)`}
            onClick={() => {
              if (href) void openUrl(href);
            }}
          >
            <Icon aria-hidden="true" className="size-3.5" />
          </IconButton>
        ))}
      </div>
    </nav>
  );
}
