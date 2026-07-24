import { useState } from "react";
import { LoaderCircle, RefreshCcw, Unlink } from "lucide-react";
import { SiDiscord } from "react-icons/si";

import { Badge } from "@/ui";
import { Button } from "@/ui";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui";
import { formatTime } from "@/features/spaces/libraryFormat";
import { useDiscordLink } from "@/features/spaces/integrations/useDiscordLink";
import type { SpaceDiscordLink } from "@/models/interfaces/features/spaces/integrations/discord";
import type { DiscordLinkDirection } from "@/models/types/features/spaces/integrations/discord";

/**
 * Space ↔ Discord link management. Beta links one channel to one conversation;
 * the panel is the only place that write relationship can be created or torn
 * down, so the current state has to be legible at a glance.
 */
export function DiscordLinkPanel({ spaceId, canManage }: { spaceId: string; canManage: boolean }) {
  const discord = useDiscordLink(spaceId, canManage);
  const [channelId, setChannelId] = useState("");
  const [conversationId, setConversationId] = useState("");

  return (
    <Card aria-labelledby="discord-link-heading">
      <CardHeader className="flex flex-row items-start justify-between gap-5">
        <div>
          <CardTitle id="discord-link-heading" className="flex items-center gap-2">
            <SiDiscord aria-hidden />
            Discord
          </CardTitle>
          <p className="mb-0 mt-1 text-sm text-muted-foreground">
            Mirror one Discord channel into a Space conversation. Messages you send in Misty can be
            posted back to Discord.
          </p>
        </div>
        {discord.link ? <LinkStatusBadge link={discord.link} /> : null}
      </CardHeader>
      <CardContent className="grid gap-4">
        {discord.error ? (
          <p
            className="m-0 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            role="alert"
          >
            {discord.error}
          </p>
        ) : null}

        {discord.loading ? (
          <p className="m-0 flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" aria-hidden />
            Checking Discord…
          </p>
        ) : discord.providerDiscoveryError ? (
          <div className="grid justify-items-start gap-3">
            <p className="m-0 text-sm text-muted-foreground">{discord.providerDiscoveryError}</p>
            <Button variant="outline" type="button" onClick={() => void discord.reload()}>
              <RefreshCcw className="size-4" aria-hidden />
              Try again
            </Button>
          </div>
        ) : discord.providerConfigured === false ? (
          <p className="m-0 text-sm text-muted-foreground">
            Discord sign-in is not available on this Misty server yet.
          </p>
        ) : !discord.integration ? (
          <ConnectPrompt
            busy={discord.busy === "connect"}
            canManage={canManage}
            onConnect={discord.connect}
          />
        ) : discord.link ? (
          <LinkedChannel
            link={discord.link}
            busy={discord.busy}
            canManage={canManage}
            conversationTitle={
              discord.conversations.find((item) => item.id === discord.link?.conversation_id)?.title
            }
            onDirection={discord.setDirection}
            onSync={discord.sync}
            onUnlink={discord.unlink}
          />
        ) : (
          <ChannelPicker
            channels={discord.channels}
            discoveryError={discord.channelDiscoveryError}
            conversations={discord.conversations}
            conversationDiscoveryError={discord.conversationDiscoveryError}
            channelId={channelId}
            conversationId={conversationId}
            busy={discord.busy === "link"}
            canManage={canManage}
            onChannel={setChannelId}
            onConversation={setConversationId}
            onLink={() => void discord.linkChannel(channelId, conversationId)}
            onRetry={() => void discord.reload()}
          />
        )}
      </CardContent>
    </Card>
  );
}

function ConnectPrompt({
  busy,
  canManage,
  onConnect,
}: {
  busy: boolean;
  canManage: boolean;
  onConnect: () => void;
}) {
  return (
    <div className="grid gap-3">
      <p className="m-0 text-sm text-muted-foreground">
        Connect Discord to this Space, then choose a channel to mirror.
      </p>
      <Button
        className="justify-self-start"
        type="button"
        disabled={!canManage || busy}
        onClick={onConnect}
      >
        {busy ? (
          <LoaderCircle className="size-4 animate-spin" aria-hidden />
        ) : (
          <SiDiscord aria-hidden />
        )}
        Connect Discord
      </Button>
    </div>
  );
}

function ChannelPicker({
  channels,
  discoveryError,
  conversations,
  conversationDiscoveryError,
  channelId,
  conversationId,
  busy,
  canManage,
  onChannel,
  onConversation,
  onLink,
  onRetry,
}: {
  channels: Array<{ external_resource_id: string; display_name: string }>;
  discoveryError: string;
  conversations: Array<{ id: string; title: string }>;
  conversationDiscoveryError: string;
  channelId: string;
  conversationId: string;
  busy: boolean;
  canManage: boolean;
  onChannel: (value: string) => void;
  onConversation: (value: string) => void;
  onLink: () => void;
  onRetry: () => void;
}) {
  if (discoveryError)
    return (
      <div className="grid justify-items-start gap-3">
        <p className="m-0 text-sm text-muted-foreground">
          Misty could not check Discord channels. Reconnect Discord or try again.
        </p>
        <Button variant="outline" type="button" onClick={onRetry}>
          <RefreshCcw className="size-4" aria-hidden />
          Try again
        </Button>
      </div>
    );
  if (conversationDiscoveryError)
    return (
      <div className="grid justify-items-start gap-3">
        <p className="m-0 text-sm text-muted-foreground">{conversationDiscoveryError}</p>
        <Button variant="outline" type="button" onClick={onRetry}>
          <RefreshCcw className="size-4" aria-hidden />
          Try again
        </Button>
      </div>
    );
  if (!channels.length)
    return (
      <p className="m-0 text-sm text-muted-foreground">
        Misty cannot see any channels yet. Invite the Misty bot to a channel in Discord, then reopen
        this panel.
      </p>
    );

  return (
    <div className="grid gap-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <PickerSelect
          label="Discord channel"
          placeholder="Choose a channel"
          value={channelId}
          options={channels.map((channel) => [
            channel.external_resource_id,
            `#${channel.display_name}`,
          ])}
          onChange={onChannel}
        />
        <PickerSelect
          label="Space conversation"
          placeholder="Choose a conversation"
          value={conversationId}
          options={conversations.map((conversation) => [conversation.id, conversation.title])}
          onChange={onConversation}
        />
      </div>
      <Button
        className="justify-self-start"
        type="button"
        disabled={!canManage || busy || !channelId || !conversationId}
        onClick={onLink}
      >
        {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
        Link channel
      </Button>
    </div>
  );
}

function LinkedChannel({
  link,
  busy,
  canManage,
  conversationTitle,
  onDirection,
  onSync,
  onUnlink,
}: {
  link: SpaceDiscordLink;
  busy: string;
  canManage: boolean;
  conversationTitle?: string;
  onDirection: (direction: DiscordLinkDirection) => void;
  onSync: () => void;
  onUnlink: () => void;
}) {
  return (
    <div className="grid gap-3">
      <p className="m-0 text-sm">
        <strong>#{link.channel_name}</strong>
        {link.guild_name ? (
          <span className="text-muted-foreground"> in {link.guild_name}</span>
        ) : null}
        <span className="text-muted-foreground"> ↔ {conversationTitle ?? "this Space"}</span>
      </p>
      <p className="m-0 text-xs text-muted-foreground">
        {link.last_synced_at ? `Last synced ${formatTime(link.last_synced_at)}` : "Not synced yet"}
        {link.last_error_code ? ` · ${linkErrorMessage(link.last_error_code)}` : ""}
      </p>
      <div className="grid gap-2 sm:max-w-xs">
        <PickerSelect
          label="Mirror direction"
          placeholder="Two-way"
          value={link.direction}
          options={[
            ["two_way", "Two-way"],
            ["inbound", "Discord → Misty only"],
            ["outbound", "Misty → Discord only"],
          ]}
          onChange={(value) => onDirection(value as DiscordLinkDirection)}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          type="button"
          disabled={!canManage || Boolean(busy)}
          onClick={onSync}
        >
          <RefreshCcw className={`size-4 ${busy === "sync" ? "animate-spin" : ""}`} aria-hidden />
          Sync now
        </Button>
        <Button
          variant="ghost"
          type="button"
          disabled={!canManage || Boolean(busy)}
          onClick={onUnlink}
        >
          <Unlink className="size-4" aria-hidden />
          Unlink
        </Button>
      </div>
    </div>
  );
}

function PickerSelect({
  label,
  placeholder,
  value,
  options,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  options: Array<[string, string]> | string[][];
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1 text-xs text-muted-foreground">
      {label}
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-9 w-full text-xs" aria-label={label}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map(([id, name]) => (
            <SelectItem value={id} key={id}>
              {name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

function LinkStatusBadge({ link }: { link: SpaceDiscordLink }) {
  if (link.status === "active") return <Badge variant="secondary">Linked</Badge>;
  if (link.status === "needs_attention")
    return <Badge variant="destructive">Needs attention</Badge>;
  if (link.status === "syncing") return <Badge variant="outline">Syncing</Badge>;
  if (link.status === "disabled") return <Badge variant="outline">Disabled</Badge>;
  return <Badge variant="outline">Pending</Badge>;
}

/** Discord's own error bodies are not user-facing copy. */
function linkErrorMessage(code: string) {
  const messages: Record<string, string> = {
    missing_access: "Misty lost access to this channel. Check the bot's Discord permissions.",
    unknown_channel: "That Discord channel no longer exists.",
    rate_limited: "Discord is rate limiting Misty. Syncing will resume shortly.",
    token_expired: "Reconnect Discord to keep mirroring this channel.",
    webhook_missing: "Misty cannot post to this channel. Re-link it to restore sending.",
  };
  return messages[code] ?? "Discord reported a problem with this channel.";
}
