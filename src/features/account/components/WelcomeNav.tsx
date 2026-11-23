import { routes } from "@/app/shell";
import { Button, IconButton, Mark, Surface, Text } from "@misty/ui";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { ComponentType, SVGProps } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { DiscordMark, GithubMark, InstagramMark, XMark, YoutubeMark } from "./SocialMarks";

const socialAccounts: {
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  href?: string;
}[] = [
  { label: "GitHub", icon: GithubMark, href: "https://github.com/misty-org" },
  { label: "X", icon: XMark },
  { label: "Discord", icon: DiscordMark, href: "https://discord.gg/B5WgSw6uX" },
  { label: "YouTube", icon: YoutubeMark },
  { label: "Instagram", icon: InstagramMark },
];

export function WelcomeNav() {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <Surface
      as="nav"
      aria-label="Misty"
      tone="none"
      edge="hairline"
      radius="xl"
      className="absolute inset-x-4 top-1 z-10 mx-auto flex h-(--ui-header) max-w-5xl items-center gap-2 px-2 sm:inset-x-8"
    >
      <Button
        variant="quiet"
        aria-label="Misty home"
        icon={<Mark of="misty" size={16} aria-hidden />}
        onClick={() => navigate(routes.welcome, { state: location.state })}
      >
        <Text bare size="page" weight="semibold" tone="bright">
          Misty
        </Text>
      </Button>
      <div className="ml-auto flex items-center gap-1">
        {socialAccounts.map(({ label, icon: Icon, href }) => (
          <IconButton
            key={label}
            label={`Misty on ${label}`}
            disabled={!href}
            onClick={href ? () => void openUrl(href) : undefined}
          >
            <Icon aria-hidden="true" />
          </IconButton>
        ))}
      </div>
    </Surface>
  );
}
