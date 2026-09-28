import type { SocialProviderId } from "@/api/social";
import type { SpaceConversation } from "@/api/spaces/dto/interfaces/types";
import { BrandIcon } from "@/shared/ui";
import { InstagramBrandIcon } from "../../social/InstagramBrandIcon";
import { MessengerBrandIcon, XBrandIcon } from "../../social/SocialProviderBrandIcons";
import { socialProvider } from "../../social/socialRoute";

export const providerLabels: Record<SocialProviderId, string> = {
  misty: "Misty",
  discord: "Discord",
  instagram: "Instagram",
  messenger: "Messenger",
  x: "X",
};
export interface ConversationGroup {
  id: string;
  title: string;
  provider: SocialProviderId;
  /** Only Misty channels include the Space-wide "Everyone" conversation. */
  everyone?: boolean;
  conversations: SpaceConversation[];
}
const byRecent = (left: SpaceConversation, right: SpaceConversation) =>
  right.updated_at.localeCompare(left.updated_at);
/** Channels, then direct messages, then one group per connected provider. */
export function groupConversations(conversations: SpaceConversation[]): ConversationGroup[] {
  const visible = conversations.filter((item) => !item.direct_agent_id).sort(byRecent);
  const misty = visible.filter((item) => (socialProvider(item.origin) ?? "misty") === "misty");
  const groups: ConversationGroup[] = [
    {
      id: "channels",
      title: "Channels",
      provider: "misty",
      everyone: true,
      conversations: misty.filter((item) => item.kind !== "direct"),
    },
    {
      id: "direct",
      title: "Direct messages",
      provider: "misty",
      conversations: misty.filter((item) => item.kind === "direct"),
    },
  ];
  for (const provider of ["discord", "instagram", "messenger", "x"] as const) {
    const items = visible.filter((item) => socialProvider(item.origin) === provider);
    if (items.length)
      groups.push({ id: provider, title: providerLabels[provider], provider, conversations: items });
  }
  return groups;
}
/** Direct messages are titled by the other person; everything else by its own name. */
export function conversationName(conversation: SpaceConversation, currentUserId?: string) {
  if (conversation.external_display_name) return conversation.external_display_name;
  if (conversation.kind === "direct") {
    const other = conversation.participants.find((p) => p.user_id && p.user_id !== currentUserId);
    if (other?.name) return other.name;
  }
  return conversation.title || "Conversation";
}
export function ProviderIcon({ provider }: { provider: SocialProviderId }) {
  if (provider === "discord") return <BrandIcon brand="discord" size={14} aria-hidden />;
  if (provider === "instagram") return <InstagramBrandIcon size={14} aria-hidden />;
  if (provider === "messenger") return <MessengerBrandIcon size={14} aria-hidden />;
  if (provider === "x") return <XBrandIcon size={14} aria-hidden />;
  return null;
}
