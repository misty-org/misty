import type { SocialProviderId } from "@/api/social";

export function socialProvider(value: string | null | undefined): SocialProviderId | null {
  return value === "misty" ||
    value === "instagram" ||
    value === "discord" ||
    value === "messenger" ||
    value === "x"
    ? value
    : null;
}

export function socialProviderFromRoute(route: string): SocialProviderId {
  try {
    const parsed = new URL(route, "https://misty.local");
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts[0] === "apps" && parts[1] === "social")
      return socialProvider(parsed.searchParams.get("provider")) ?? "misty";
    if (parts[0] === "spaces" && parts[2] === "social") {
      return (
        socialProvider(parts[3]) ?? socialProvider(parsed.searchParams.get("provider")) ?? "misty"
      );
    }
  } catch {
    // Malformed routes fall back to the private Misty page.
  }
  return "misty";
}

export function socialProviderPath(
  spaceId: string,
  provider: SocialProviderId,
  query?: string | URLSearchParams,
): string {
  const params =
    query instanceof URLSearchParams
      ? new URLSearchParams(query)
      : new URLSearchParams(query?.replace(/^\?/, "") ?? "");
  params.delete("provider");
  const search = params.toString();
  const base = `/spaces/${encodeURIComponent(spaceId)}/social/${provider}`;
  return search ? `${base}?${search}` : base;
}

export function socialConversationPath(
  spaceId: string,
  provider: SocialProviderId,
  conversationId: string,
): string {
  const params = new URLSearchParams({ conversation: conversationId });
  return socialProviderPath(spaceId, provider, params);
}
