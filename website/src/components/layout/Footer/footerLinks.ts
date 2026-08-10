import type { IconType } from "react-icons";
import {
  FaDiscord,
  FaGithub,
  FaInstagram,
  FaXTwitter,
  FaYoutube,
} from "react-icons/fa6";

import { JOIN_HREF, PUBLIC_RELEASES_URL } from "@/lib/site";

export interface FooterColumn {
  label: string;
  links: { to: string; text: string; external?: boolean }[];
}

export const columns: FooterColumn[] = [
  {
    label: "Explore",
    links: [
      { to: "/features", text: "Features" },
      { to: "/pricing", text: "Pricing" },
      { to: "/download", text: "Download" },
      { to: JOIN_HREF, text: "Join now" },
    ],
  },
  {
    label: "Resources",
    links: [
      { to: "/blog", text: "Blog" },
      { to: "/roadmap", text: "Roadmap" },
      { to: "/changelog", text: "Changelog" },
      { to: PUBLIC_RELEASES_URL, text: "Public releases", external: true },
    ],
  },
];

export const legalLinks: { to: string; text: string }[] = [
  { to: "/privacy", text: "Privacy" },
  { to: "/terms", text: "Terms" },
  { to: "/license", text: "License" },
];

export const socialLinks: {
  label: string;
  href: string;
  icon: IconType;
  placeholder?: boolean;
}[] = [
  {
    label: "GitHub",
    href: "https://github.com/misty-org",
    icon: FaGithub,
  },
  { label: "X.com", href: "#", icon: FaXTwitter, placeholder: true },
  { label: "Discord", href: "#", icon: FaDiscord, placeholder: true },
  { label: "YouTube", href: "#", icon: FaYoutube, placeholder: true },
  { label: "Instagram", href: "#", icon: FaInstagram, placeholder: true },
];
