import type { AccountConnection } from "@/api/connections";
import type { SocialProviderId } from "@/api/social";
import type { SpaceConversation } from "@/api/spaces/dto/interfaces/types";
import { MistyBrandIcon } from "@/features/workspace";
import {
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  cn,
} from "@/shared/ui";
import { MessagesSquare, Pencil, Plus, Trash2, Users } from "lucide-react";
import { SiDiscord } from "react-icons/si";
import { Link } from "react-router-dom";
import { InstagramBrandIcon } from "../social/InstagramBrandIcon";
import { MessengerBrandIcon, XBrandIcon } from "../social/SocialProviderBrandIcons";
import { socialConversationPath, socialProvider, socialProviderPath } from "../social/socialRoute";
import { SpaceSidebarSection } from "./SpaceSidebarSection";

export function SpaceChatConversationList({
  activeSpaceId,
  conversations,
  activeConversationId,
  provider,
  currentUserId,
  onCreateConversation,
  onEditConversation,
  onDeleteConversation,
  isSpaceOwner = false,
  accounts = [],
  accountsLoading = false,
  authorizingProvider = null,
  onConnectAccount,
}: {
  activeSpaceId: string;
  conversations: SpaceConversation[];
  activeConversationId: string | null;
  provider: SocialProviderId;
  currentUserId?: string;
  onCreateConversation?: () => void;
  onEditConversation?: (conversation: SpaceConversation) => void;
  onDeleteConversation?: (conversation: SpaceConversation) => void;
  isSpaceOwner?: boolean;
  accounts?: AccountConnection[];
  accountsLoading?: boolean;
  authorizingProvider?: string | null;
  onConnectAccount?: (provider: Exclude<SocialProviderId, "misty">) => void;
}) {
  const visibleConversations = conversations
    .filter((conversation) => !conversation.direct_agent_id)
    .filter((conversation) => conversation.origin === provider)
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
  const showEveryone = provider === "misty";
  const conversationCount = visibleConversations.length + (showEveryone ? 1 : 0);
  const providerAccounts =
    provider === "misty"
      ? []
      : accounts.filter((account) => socialProvider(account.provider) === provider);
  const messageSection = messageSectionLabel(provider);
  const connectableProvider = provider === "misty" ? null : provider;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="misty-transient-scrollbar min-h-0 flex-1 overflow-y-auto pr-1 [overscroll-behavior:contain]">
        <SpaceSidebarSection
          title={messageSection}
          count={conversationCount}
          action={
            provider === "misty" && onCreateConversation ? (
              <Button
                variant="ghost"
                size="icon"
                className="misty-sidebar-icon-target size-7 shrink-0 shadow-none"
                type="button"
                aria-label="Create a new Misty conversation"
                onClick={onCreateConversation}
              >
                <Plus size={13} />
              </Button>
            ) : undefined
          }
        >
          <nav
            className="grid gap-1"
            aria-label={`${providerLabel(provider)} ${messageSection.toLowerCase()}`}
          >
            {showEveryone ? (
              <Link
                className={conversationLinkClass(!activeConversationId)}
                to={socialProviderPath(activeSpaceId, provider)}
              >
                <span className="grid size-6 place-items-center text-cream-muted">
                  <Users size={17} strokeWidth={1.75} />
                </span>
                <span className="min-w-0 truncate font-medium">Everyone</span>
              </Link>
            ) : null}

            {visibleConversations.map((conversation) => {
              const canRename = Boolean(
                onEditConversation &&
                conversation.kind !== "direct" &&
                conversation.created_by_user_id === currentUserId,
              );
              const canDelete = Boolean(
                onDeleteConversation &&
                (isSpaceOwner || conversation.created_by_user_id === currentUserId),
              );
              const link = (
                <Link
                  className={conversationLinkClass(activeConversationId === conversation.id)}
                  to={socialConversationPath(activeSpaceId, provider, conversation.id)}
                  title={conversation.external_display_name || conversation.title}
                >
                  <span className="grid size-6 place-items-center">
                    <ConversationProviderIcon provider={conversation.origin} />
                  </span>
                  <span className="min-w-0 truncate font-medium">
                    {conversation.external_display_name || conversation.title}
                  </span>
                  {conversation.integration_status === "disconnected" ? (
                    <span className="pr-2 text-[10px] text-cream-faint">Disconnected</span>
                  ) : null}
                </Link>
              );
              if (!canRename && !canDelete) return <div key={conversation.id}>{link}</div>;
              return (
                <ContextMenu key={conversation.id}>
                  <ContextMenuTrigger asChild>{link}</ContextMenuTrigger>
                  <ContextMenuContent className="w-44">
                    {canRename ? (
                      <ContextMenuItem onSelect={() => onEditConversation?.(conversation)}>
                        <Pencil />
                        Edit conversation
                      </ContextMenuItem>
                    ) : null}
                    {canRename && canDelete ? <ContextMenuSeparator /> : null}
                    {canDelete ? (
                      <ContextMenuItem
                        className="text-cream-bright focus:bg-charcoal-active focus:text-cream-bright"
                        onSelect={() => onDeleteConversation?.(conversation)}
                      >
                        <Trash2 />
                        Delete conversation
                      </ContextMenuItem>
                    ) : null}
                  </ContextMenuContent>
                </ContextMenu>
              );
            })}

            {conversationCount === 0 ? (
              <p className="px-2 py-2 text-[11px] text-cream-muted">
                No {messageSection.toLowerCase()} yet.
              </p>
            ) : null}
          </nav>
        </SpaceSidebarSection>
      </div>

      {provider !== "misty" ? (
        <div className="mt-3 shrink-0 border-t border-charcoal-border pt-3">
          <SpaceSidebarSection
            title="Accounts"
            count={providerAccounts.length}
            collapsible={false}
            action={
              connectableProvider && onConnectAccount ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="misty-sidebar-icon-target size-7 shrink-0 shadow-none"
                  type="button"
                  aria-label={`Connect ${providerLabel(provider)}`}
                  title={`Connect ${providerLabel(provider)}`}
                  disabled={Boolean(authorizingProvider)}
                  onClick={() => onConnectAccount(connectableProvider)}
                >
                  <Plus size={13} />
                </Button>
              ) : undefined
            }
          >
            <div className="misty-transient-scrollbar grid max-h-40 gap-1 overflow-y-auto">
              {providerAccounts.map((account) => {
                const accountProvider = socialProvider(account.provider);
                if (!accountProvider || accountProvider === "misty") return null;
                return (
                  <Button key={account.id} asChild variant="ghost">
                    <Link
                      to={socialProviderPath(activeSpaceId, accountProvider)}
                      className={cn(
                        "misty-sidebar-row-target min-h-9 w-full justify-start gap-3 rounded-md px-3 py-1.5 text-left font-normal shadow-none",
                        "text-cream-muted hover:bg-charcoal-card hover:text-cream focus-visible:ring-2 focus-visible:ring-charcoal-active",
                        provider === accountProvider && "bg-charcoal-card text-cream-bright",
                      )}
                      aria-current={provider === accountProvider ? "page" : undefined}
                    >
                      <ConversationProviderIcon provider={account.provider} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium text-cream">
                          {account.account_display || providerLabel(account.provider)}
                        </span>
                        <span className="block truncate text-[10px] text-cream-faint">
                          {providerLabel(account.provider)}
                          {account.status === "active" ? "" : " · Needs attention"}
                        </span>
                      </span>
                    </Link>
                  </Button>
                );
              })}
              {!providerAccounts.length && accountsLoading ? (
                <p className="px-2 py-2 text-[11px] text-cream-muted">Loading accounts…</p>
              ) : null}
              {!providerAccounts.length && !accountsLoading && connectableProvider ? (
                <Button
                  type="button"
                  variant="ghost"
                  className={cn(
                    "misty-sidebar-row-target min-h-9 w-full justify-start rounded-md px-3 text-left text-[11px] font-normal shadow-none",
                    "text-cream-muted hover:bg-charcoal-card hover:text-cream focus-visible:ring-2 focus-visible:ring-charcoal-active",
                  )}
                  disabled={Boolean(authorizingProvider)}
                  onClick={() => onConnectAccount?.(connectableProvider)}
                >
                  {authorizingProvider === provider
                    ? "Connecting…"
                    : `Connect ${providerLabel(provider)}`}
                </Button>
              ) : null}
            </div>
          </SpaceSidebarSection>
        </div>
      ) : null}
    </div>
  );
}

function ConversationProviderIcon({ provider }: { provider?: string }) {
  if (provider === "discord") {
    return <SiDiscord className="size-4 shrink-0 text-[#5865F2]" aria-hidden />;
  }
  if (provider === "instagram") {
    return <InstagramBrandIcon className="size-4 shrink-0" aria-hidden />;
  }
  if (provider === "messenger") {
    return <MessengerBrandIcon className="size-4 shrink-0 text-[#0A7CFF]" aria-hidden />;
  }
  if (provider === "x") {
    return <XBrandIcon className="size-4 shrink-0 text-cream-bright" aria-hidden />;
  }
  if (!provider || provider === "misty") {
    return <MistyBrandIcon className="size-4 shrink-0" aria-hidden />;
  }
  return <MessagesSquare className="size-4 shrink-0 text-cream-muted" aria-hidden />;
}

function providerLabel(provider: string): string {
  if (provider === "instagram") return "Instagram";
  if (provider === "discord") return "Discord";
  if (provider === "messenger") return "Messenger";
  if (provider === "x") return "X";
  if (provider === "misty") return "Misty";
  return "Misty";
}

function messageSectionLabel(provider: SocialProviderId): string {
  return provider === "discord" || provider === "x" ? "Direct messages" : "Conversations";
}

function conversationLinkClass(isActive: boolean) {
  return cn(
    [
      "misty-marker-host misty-sidebar-row-target relative grid min-h-9 grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-1.5 rounded-md",
      "text-[13px] no-underline outline-none transition-colors",
      "focus-visible:ring-2 focus-visible:ring-charcoal-active",
    ].join(" "),
    isActive
      ? "misty-active-marker-side text-cream-bright font-medium"
      : "text-cream-muted hover:text-cream",
  );
}
