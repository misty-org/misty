import type {
  SlackLinkDirection,
  SpaceSlackLink,
} from "@/api/spaces/dto/interfaces/connections/slack";
import { formatTime } from "@/features/spaces/library";
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
import { LoaderCircle, RefreshCcw, Unlink } from "lucide-react";
import { useState } from "react";
import { FaSlack } from "react-icons/fa6";
import { useSlackLink } from "./useSlackLink";

export function SlackConnectionPanel(props: {
  spaceId: string;
  canManage: boolean;
  expandedByDefault?: boolean;
}) {
  const slack = useSlackLink(props.spaceId, props.canManage);
  const [expanded, setExpanded] = useState(props.expandedByDefault ?? false);
  const [channelId, setChannelId] = useState("");
  const available = slack.channels.filter(
    (channel) =>
      !slack.links.some(
        (link) => link.channel_id === channel.external_resource_id && link.status !== "disabled",
      ),
  );

  return (
    <Card size="sm" aria-labelledby="slack-link-heading">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle id="slack-link-heading" className="flex items-center gap-2">
          <FaSlack className="size-4" aria-hidden />
          Slack
        </CardTitle>
        {slack.loading ? (
          <LoaderCircle
            className="size-4 animate-spin text-cream-muted"
            aria-label="Checking Slack"
          />
        ) : slack.providerDiscoveryError ? (
          <Button size="sm" variant="outline" type="button" onClick={() => void slack.reload()}>
            Retry
          </Button>
        ) : slack.providerConfigured === false ? (
          <Badge variant="outline">Unavailable</Badge>
        ) : !slack.integration ? (
          props.canManage ? (
            <Button
              size="sm"
              type="button"
              disabled={slack.busy === "connect"}
              onClick={slack.connect}
            >
              {slack.busy === "connect" ? <LoaderCircle className="size-4 animate-spin" /> : null}
              Connect
            </Button>
          ) : (
            <Badge variant="outline">Not connected</Badge>
          )
        ) : slack.integration.status !== "active" && props.canManage ? (
          <Button size="sm" variant="outline" type="button" onClick={slack.connect}>
            Reconnect
          </Button>
        ) : (
          <div className="flex items-center gap-1.5">
            <Badge variant="secondary">
              {slack.links.length ? `${slack.links.length} linked` : "Connected"}
            </Badge>
            <Button
              size="sm"
              variant="outline"
              type="button"
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? "Done" : "Manage"}
            </Button>
          </div>
        )}
      </CardHeader>

      {slack.error || slack.providerDiscoveryError ? (
        <CardContent>
          <p className="m-0 text-xs text-cream-bright" role="alert">
            {slack.error || slack.providerDiscoveryError}
          </p>
        </CardContent>
      ) : null}

      {expanded && slack.integration ? (
        <CardContent className="grid gap-4 border-t border-charcoal-border/60 pt-4">
          {slack.syncFeedback ? (
            <p className="m-0 text-xs text-cream-muted" role="status">
              {slack.syncFeedback}
            </p>
          ) : null}
          {slack.links.map((link) => (
            <LinkedSlackChannel
              key={link.id}
              link={link}
              conversationTitle={
                slack.conversations.find((item) => item.id === link.conversation_id)?.title
              }
              busy={slack.busy}
              canManage={props.canManage}
              onDirection={(direction) => slack.setDirection(link.id, direction)}
              onSync={() => slack.sync(link.id)}
              onUnlink={() => slack.unlink(link.id)}
            />
          ))}
          <ChannelPicker
            channels={available}
            error={slack.channelDiscoveryError}
            channelId={channelId}
            hasLinks={slack.links.length > 0}
            busy={slack.busy === `link:${channelId}`}
            canManage={props.canManage}
            onChannel={setChannelId}
            onRetry={() => void slack.reload()}
            onLink={() => void slack.linkChannel(channelId).then(() => setChannelId(""))}
          />
          {props.canManage ? (
            <div className="flex items-center justify-between gap-3 border-t border-charcoal-border/60 pt-4">
              <p className="m-0 text-xs text-cream-muted">Imported messages stay in Misty.</p>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={Boolean(slack.busy)}
                onClick={slack.disconnect}
              >
                {slack.busy === "disconnect" ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Unlink className="size-4" />
                )}
                Disconnect
              </Button>
            </div>
          ) : null}
        </CardContent>
      ) : null}
    </Card>
  );
}

function LinkedSlackChannel(props: {
  link: SpaceSlackLink;
  conversationTitle?: string;
  busy: string;
  canManage: boolean;
  onDirection: (direction: SlackLinkDirection) => void;
  onSync: () => void;
  onUnlink: () => void;
}) {
  const { link } = props;
  return (
    <div className="grid gap-3 rounded-lg border border-charcoal-border/70 p-3">
      <p className="m-0 text-sm">
        <strong>#{trimChannel(link.channel_name)}</strong>
        {link.team_name ? <span className="text-cream-muted"> in {link.team_name}</span> : null}
        <span className="text-cream-muted"> ↔ {props.conversationTitle ?? "this Space"}</span>
      </p>
      <p className="m-0 text-xs text-cream-muted">
        {link.last_synced_at ? `Last synced ${formatTime(link.last_synced_at)}` : statusLabel(link)}
        {link.last_error_code ? ` · ${slackErrorMessage(link.last_error_code)}` : ""}
      </p>
      <DirectionSelect value={link.direction} onChange={props.onDirection} />
      <div className="flex gap-2">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label={`Sync #${trimChannel(link.channel_name)}`}
          disabled={!props.canManage || Boolean(props.busy)}
          onClick={props.onSync}
        >
          <RefreshCcw
            className={`size-4 ${props.busy === `sync:${link.id}` ? "animate-spin" : ""}`}
          />
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={!props.canManage || Boolean(props.busy)}
          onClick={props.onUnlink}
        >
          <Unlink className="size-4" />
          Unlink
        </Button>
      </div>
    </div>
  );
}

function ChannelPicker(props: {
  channels: Array<{ external_resource_id: string; display_name: string }>;
  error: string;
  channelId: string;
  busy: boolean;
  canManage: boolean;
  hasLinks: boolean;
  onChannel: (value: string) => void;
  onLink: () => void;
  onRetry: () => void;
}) {
  if (props.error)
    return (
      <div className="grid justify-items-start gap-2">
        <p className="m-0 text-sm text-cream-muted">Misty could not check Slack channels.</p>
        <Button type="button" variant="outline" onClick={props.onRetry}>
          Try again
        </Button>
      </div>
    );
  if (!props.channels.length)
    return (
      <p className="m-0 text-sm text-cream-muted">
        {props.hasLinks
          ? "Every available Slack channel is already linked."
          : "No Slack channels are available to link yet."}
      </p>
    );
  return (
    <div className="grid gap-3">
      <label className="grid gap-1 text-xs text-cream-muted">
        Slack channel
        <Select value={props.channelId} onValueChange={props.onChannel}>
          <SelectTrigger className="h-9 w-full text-xs" aria-label="Slack channel">
            <SelectValue placeholder="Choose a channel" />
          </SelectTrigger>
          <SelectContent>
            {props.channels.map((channel) => (
              <SelectItem value={channel.external_resource_id} key={channel.external_resource_id}>
                #{trimChannel(channel.display_name)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <Button
        type="button"
        className="justify-self-start"
        disabled={!props.canManage || props.busy || !props.channelId}
        onClick={props.onLink}
      >
        {props.busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
        Add channel
      </Button>
    </div>
  );
}

function DirectionSelect(props: {
  value: SlackLinkDirection;
  onChange: (value: SlackLinkDirection) => void;
}) {
  return (
    <label className="grid max-w-xs gap-1 text-xs text-cream-muted">
      Mirror direction
      <Select
        value={props.value}
        onValueChange={(value) => props.onChange(value as SlackLinkDirection)}
      >
        <SelectTrigger className="h-9" aria-label="Slack mirror direction">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="two_way">Two-way</SelectItem>
          <SelectItem value="inbound">Slack → Misty only</SelectItem>
          <SelectItem value="outbound">Misty → Slack only</SelectItem>
        </SelectContent>
      </Select>
    </label>
  );
}

const trimChannel = (value: string) => value.replace(/^#/, "");
const statusLabel = (link: SpaceSlackLink) =>
  link.status === "pending" || link.status === "syncing"
    ? "Initial sync in progress"
    : "Not synced yet";

function slackErrorMessage(code: string) {
  const messages: Record<string, string> = {
    missing_access: "Misty lost access to this Slack channel.",
    token_expired: "Reconnect Slack to keep mirroring this channel.",
    rate_limited: "Slack is rate limiting Misty. Try syncing again shortly.",
    unknown_channel: "That Slack channel no longer exists.",
  };
  return messages[code] ?? "Slack reported a problem with this channel.";
}
