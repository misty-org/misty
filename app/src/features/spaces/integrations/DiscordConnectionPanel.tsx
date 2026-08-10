import { LoaderCircle, RefreshCcw, Trash2, Unlink } from "lucide-react";
import { useState } from "react";
import { SiDiscord } from "react-icons/si";

import { formatTime } from "@/features/spaces/library";
import { spacesApi } from "@/api/spaces/api";
import type { SpaceDiscordLink } from "@/api/spaces/dto/interfaces/connections/discord";
import type { DiscordLinkDirection } from "@/api/spaces/dto/types/connections/discord";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui";
import { useDiscordLink } from "./useDiscordLink";

/**
 * Space ↔ Discord link management. Each selected channel gets an ordinary
 * Misty conversation, automatically grouped under Discord in Chat.
 */
export function DiscordConnectionPanel({
  spaceId,
  canManage,
}: {
  spaceId: string;
  canManage: boolean;
}) {
  const discord = useDiscordLink(spaceId, canManage);
  const [channelId, setChannelId] = useState("");
  const [deletingConversationId, setDeletingConversationId] = useState("");
  const [expanded, setExpanded] = useState(false);
  const availableChannels = discord.channels.filter(
    (channel) =>
      !discord.links.some(
        (link) => link.channel_id === channel.external_resource_id && link.status !== "disabled",
      ),
  );

  return (
    <Card
      size="sm"
      className={expanded ? "sm:col-span-2 xl:col-span-3" : ""}
      aria-labelledby="discord-link-heading"
    >
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div className="min-w-0">
          <CardTitle id="discord-link-heading" className="flex items-center gap-2">
            <span className="grid size-5 shrink-0 place-items-center" aria-hidden>
              <SiDiscord className="size-4 overflow-visible" />
            </span>
            <span className="truncate">Discord</span>
          </CardTitle>
        </div>
        {discord.loading ? (
          <LoaderCircle
            className="size-4 shrink-0 animate-spin text-cream-muted"
            aria-label="Checking Discord"
          />
        ) : discord.providerDiscoveryError ? (
          <Button size="sm" variant="outline" type="button" onClick={() => void discord.reload()}>
            Retry
          </Button>
        ) : discord.providerConfigured === false ? (
          <Badge variant="outline">Unavailable</Badge>
        ) : !discord.integration ? (
          canManage ? (
            <Button
              size="sm"
              type="button"
              disabled={discord.busy === "connect"}
              onClick={discord.connect}
            >
              {discord.busy === "connect" ? (
                <LoaderCircle className="size-4 animate-spin" aria-hidden />
              ) : null}
              Connect
            </Button>
          ) : (
            <Badge variant="outline">Not connected</Badge>
          )
        ) : (
          <div className="flex shrink-0 items-center gap-1.5">
            <Badge className="hidden lg:inline-flex" variant="secondary">
              {discord.links.length ? `${discord.links.length} linked` : "Connected"}
            </Badge>
            <Button
              size="sm"
              variant="outline"
              type="button"
              onClick={() => setExpanded((current) => !current)}
            >
              {expanded ? "Done" : "Manage"}
            </Button>
          </div>
        )}
      </CardHeader>

      {discord.error || discord.providerDiscoveryError ? (
        <CardContent>
          <p className="m-0 text-xs text-cream-bright" role="alert">
            {discord.error || discord.providerDiscoveryError}
          </p>
        </CardContent>
      ) : null}

      {expanded && discord.integration ? (
        <CardContent className="grid gap-4 border-t border-charcoal-border/60 pt-4">
          {discord.links.map((link) => (
            <LinkedChannel
              key={link.id}
              link={link}
              busy={discord.busy}
              canManage={canManage}
              conversationTitle={
                discord.conversations.find((item) => item.id === link.conversation_id)?.title
              }
              onDirection={(direction) => discord.setDirection(link.id, direction)}
              onSync={() => discord.sync(link.id)}
              onUnlink={() => discord.unlink(link.id)}
            />
          ))}
          {discord.conversations
            .filter(
              (conversation) =>
                conversation.origin === "discord" &&
                conversation.integration_status === "disconnected",
            )
            .map((conversation) => (
              <div
                className="flex items-center gap-3 rounded-lg border border-dashed border-charcoal-border p-3"
                key={conversation.id}
              >
                <div className="min-w-0 flex-1">
                  <p className="m-0 truncate text-sm font-medium">
                    #{conversation.external_display_name || conversation.title}
                  </p>
                  <p className="mb-0 mt-0.5 text-xs text-cream-muted">
                    Disconnected · Misty history preserved
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  type="button"
                  disabled={!canManage || Boolean(deletingConversationId)}
                  onClick={() => {
                    setDeletingConversationId(conversation.id);
                    void spacesApi
                      .deleteDisconnectedConversation(spaceId, conversation.id)
                      .then(() => discord.reload())
                      .finally(() => setDeletingConversationId(""));
                  }}
                >
                  {deletingConversationId === conversation.id ? (
                    <LoaderCircle className="size-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="size-3.5" />
                  )}
                  Delete history
                </Button>
              </div>
            ))}
          <ChannelPicker
            channels={availableChannels}
            discoveryError={discord.channelDiscoveryError}
            channelId={channelId}
            busy={discord.busy === `link:${channelId}`}
            canManage={canManage}
            hasLinks={discord.links.length > 0}
            onChannel={setChannelId}
            onLink={() => {
              void discord.linkChannel(channelId).then(() => setChannelId(""));
            }}
            onRetry={() => void discord.reload()}
          />
        </CardContent>
      ) : null}
    </Card>
  );
}

function ChannelPicker({
  channels,
  discoveryError,
  channelId,
  busy,
  canManage,
  hasLinks,
  onChannel,
  onLink,
  onRetry,
}: {
  channels: Array<{ external_resource_id: string; display_name: string }>;
  discoveryError: string;
  channelId: string;
  busy: boolean;
  canManage: boolean;
  hasLinks: boolean;
  onChannel: (value: string) => void;
  onLink: () => void;
  onRetry: () => void;
}) {
  if (discoveryError)
    return (
      <div className="grid justify-items-start gap-3">
        <p className="m-0 text-sm text-cream-muted">
          Misty could not check Discord channels. Reconnect Discord or try again.
        </p>
        <Button variant="outline" type="button" onClick={onRetry}>
          <RefreshCcw className="size-4" aria-hidden />
          Try again
        </Button>
      </div>
    );
  if (!channels.length)
    return (
      <p className="m-0 text-sm text-cream-muted">
        {hasLinks
          ? "Every available Discord channel is already linked."
          : "Misty cannot see any channels yet. Invite the Misty bot to a channel in Discord, then reopen this panel."}
      </p>
    );

  return (
    <div className="grid gap-3">
      <div className="grid gap-2 sm:max-w-sm">
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
      </div>
      <Button
        className="justify-self-start"
        type="button"
        disabled={!canManage || busy || !channelId}
        onClick={onLink}
      >
        {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
        Add channel
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
    <div className="grid gap-3 rounded-lg border border-charcoal-border/70 p-3">
      <p className="m-0 text-sm">
        <strong>#{link.channel_name}</strong>
        {link.guild_name ? <span className="text-cream-muted"> in {link.guild_name}</span> : null}
        <span className="text-cream-muted"> ↔ {conversationTitle ?? "this Space"}</span>
      </p>
      <p className="m-0 text-xs text-cream-muted">
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
          aria-label={`Sync #${link.channel_name}`}
          className="size-8 text-cream-muted/70 shadow-none hover:text-cream"
          size="icon"
          title={`Sync #${link.channel_name}`}
          variant="ghost"
          type="button"
          disabled={!canManage || Boolean(busy)}
          onClick={onSync}
        >
          <RefreshCcw
            className={`size-4 ${busy === `sync:${link.id}` ? "animate-spin" : ""}`}
            aria-hidden
          />
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
    <label className="grid gap-1 text-xs text-cream-muted">
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
