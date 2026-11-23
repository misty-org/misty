import { useRef, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Button, ChannelReply, InlineLink, RoleMention, Textarea } from "@misty/ui";
import type { SpaceMessage } from "../../api/dto/entities";
import type { MessageSpan } from "../../api/dto/common";
import { ChatAvatar } from "./ChatAvatar";
import { messageReplyPreviewText } from "./message_text";
import { useSpaceRolesStore } from "../../roles/use_space_roles";

export function messageTextForLinks(spans: MessageSpan[]): string {
  return spans
    .map((span) => (span.type === "text" ? span.text : span.type === "link" ? ` ${span.url} ` : ""))
    .join("");
}

export function Span(props: { span: MessageSpan; plainMentions: boolean }) {
  const { span } = props;
  if (span.type === "text") {
    if (!props.plainMentions) return <>{span.text}</>;
    return span.text
      .split(/(@[\p{L}\p{N}_.'’-]+(?:\s+[\p{Lu}][\p{L}\p{N}_.'’-]*){0,2})/gu)
      .map((part, index) =>
        part.startsWith("@") ? (
          <RoleMention key={index} label={part.slice(1)} />
        ) : (
          <span key={index}>{part}</span>
        ),
      );
  }
  if (span.type === "link")
    return (
      <InlineLink asChild>
        <Link to={span.url}>{span.label}</Link>
      </InlineLink>
    );
  if ("role_id" in span) return <ChatRoleMention roleId={span.role_id} label={span.label} />;
  return <RoleMention label={span.label} />;
}

function ChatRoleMention(props: { roleId: string; label: string }) {
  const role = useSpaceRolesStore((state) => {
    for (const roles of Object.values(state.bySpace)) {
      const found = roles.find((item) => item.id === props.roleId);
      if (found) return found;
    }
    return undefined;
  });
  return <RoleMention color={role?.color || undefined} label={role?.name ?? props.label} />;
}

export function ReplyLine(props: {
  replied: SpaceMessage | undefined;
  avatarUrl: string;
  color?: string;
  earlier: boolean;
  onOpen(): void;
}) {
  const { replied } = props;
  if (!replied)
    return <ChannelReply missing={props.earlier ? "earlier" : "deleted"} onOpen={props.onOpen} />;
  return (
    <ChannelReply
      avatar={
        <ChatAvatar
          id={replied.sender_user_id || replied.sender_name}
          name={replied.sender_name}
          src={props.avatarUrl || undefined}
          size="xs"
        />
      }
      name={replied.sender_name}
      color={props.color}
      text={messageReplyPreviewText(replied)}
      onOpen={props.onOpen}
    />
  );
}

export function EditBox(props: {
  message: SpaceMessage;
  text: string;
  saving: boolean;
  onText(value: string): void;
  onCancel(messageId: string): void;
  onSubmit(event: FormEvent, message: SpaceMessage): void;
}) {
  const form = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={form}
      className="grid gap-2 py-1"
      onSubmit={(event) => props.onSubmit(event, props.message)}
    >
      <Textarea
        autoFocus
        rows={1}
        maxLength={4000}
        aria-label="Edit message"
        value={props.text}
        className="max-h-80 resize-none"
        onChange={(event) => props.onText(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Escape" && !event.shiftKey && !props.saving) {
            event.preventDefault();
            props.onCancel(props.message.id);
          } else if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            if (props.text.trim() && !props.saving) form.current?.requestSubmit();
          }
        }}
      />
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="quiet"
          size="sm"
          disabled={props.saving}
          onClick={() => props.onCancel(props.message.id)}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={props.saving || !props.text.trim()}
        >
          Save
        </Button>
      </div>
    </form>
  );
}
