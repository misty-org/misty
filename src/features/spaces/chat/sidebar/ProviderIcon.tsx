import type { SocialProviderId } from "@/api/social";
import { BrandIcon } from "@/shared/ui";
import { InstagramBrandIcon } from "../../social/InstagramBrandIcon";
import { MessengerBrandIcon, XBrandIcon } from "../../social/SocialProviderBrandIcons";
export function ProviderIcon({ provider }: { provider: SocialProviderId }) {
  if (provider === "discord") return <BrandIcon brand="discord" size={14} aria-hidden />;
  if (provider === "instagram") return <InstagramBrandIcon size={14} aria-hidden />;
  if (provider === "messenger") return <MessengerBrandIcon size={14} aria-hidden />;
  if (provider === "x") return <XBrandIcon size={14} aria-hidden />;
  return null;
}
