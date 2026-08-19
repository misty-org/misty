import { CircleAlert, LoaderCircle, Send } from "lucide-react";
import { FaSlack } from "react-icons/fa6";
import { SiDiscord } from "react-icons/si";

import type { MessageOrigin } from "@/api/spaces/dto/interfaces/connections/discord";
import { Badge } from "@/shared/ui";

/**
 * Says where a message came from, and — for Misty messages mirrored outward —
 * whether that write actually landed. A mirrored transcript is only trustworthy
 * if every line is attributable, so this badge is never decorative.
 */
export function MessageOriginBadge({
  origin,
  outboundProvider = "discord",
}: {
  origin?: MessageOrigin;
  outboundProvider?: "discord" | "slack";
}) {
  if (!origin) return null;

  if (origin.system === "discord") {
    return (
      <Badge
        variant="secondary"
        className="h-5 gap-1 px-1.5 text-[10px]"
        title="Received from Discord"
      >
        <SiDiscord aria-hidden />
        Discord
        {origin.author_handle ? (
          <span className="text-cream-muted">@{origin.author_handle}</span>
        ) : null}
      </Badge>
    );
  }

  if (origin.system === "slack") {
    return (
      <Badge
        variant="secondary"
        className="h-5 gap-1 px-1.5 text-[10px]"
        title="Received from Slack"
      >
        <FaSlack aria-hidden />
        Slack
        {origin.author_handle ? (
          <span className="text-cream-muted">{origin.author_handle}</span>
        ) : null}
      </Badge>
    );
  }

  return <PublishBadge origin={origin} provider={outboundProvider} />;
}

/** Outbound state for a Misty-authored message. Silence would hide a failed write. */
function PublishBadge({
  origin,
  provider,
}: {
  origin: MessageOrigin;
  provider: "discord" | "slack";
}) {
  const name = provider === "slack" ? "Slack" : "Discord";
  if (origin.publish_state === "publishing") {
    return (
      <Badge variant="outline" className="h-5 gap-1 px-1.5 text-[10px]">
        <LoaderCircle className="size-2.5 animate-spin" aria-hidden />
        Sending to {name}
      </Badge>
    );
  }
  if (origin.publish_state === "published") {
    return (
      <Badge
        variant="outline"
        className="h-5 gap-1 px-1.5 text-[10px]"
        title={origin.published_at ? `Sent to ${name} ${origin.published_at}` : `Sent to ${name}`}
      >
        <Send className="size-2.5" aria-hidden />
        Sent to {name}
      </Badge>
    );
  }
  if (origin.publish_state === "failed") {
    return (
      <Badge
        variant="destructive"
        className="h-5 gap-1 px-1.5 text-[10px]"
        title={origin.publish_error || `${name} rejected this message.`}
      >
        <CircleAlert className="size-2.5" aria-hidden />
        Not sent
      </Badge>
    );
  }
  return null;
}
