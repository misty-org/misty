import { Fragment, useEffect, useMemo, useState } from "react";
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Hash, X } from "lucide-react";
import {
  ChannelMessage,
  ChannelMessageText,
  CommandPaletteMatch,
  EmptyState,
  ErrorState,
  FramedBar,
  IconButton,
  SkeletonList,
  Text,
} from "@misty/ui";
import type { SpaceMessage } from "../../api/dto/entities";
import { searchSpaceMessages } from "../../search/space_search";
import { spansToText } from "./message_text";
import { ChatAvatar } from "./ChatAvatar";
import { memberOutlineFor, useMemberAvatarUrls, useMemberOutlines } from "./ChatDisplay";

type Found =
  { status: "loading" } | { status: "done"; messages: SpaceMessage[] } | { status: "failed" };

function parseQuery(query: string) {
  let from = "";
  let into = "";
  const words: string[] = [];
  for (const token of query.trim().split(/\s+/)) {
    const lower = token.toLowerCase();
    if (lower.startsWith("from:")) from = token.slice(5).replace(/^@/, "").toLowerCase();
    else if (lower.startsWith("in:")) into = token.slice(3).replace(/^#/, "").toLowerCase();
    else if (token) words.push(token);
  }
  return { from, into, words: words.join(" ") };
}

const stampFormat = new Intl.DateTimeFormat(undefined, {
  month: "numeric",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function useChatSearchResults(props: {
  spaceId: string;
  query: string;
  whereSaid(message: SpaceMessage): { name: string; direct: boolean };
  colorOf(message: SpaceMessage): string | undefined;
  onOpen(message: SpaceMessage): void;
  onClose?(): void;
}) {
  const parsed = useMemo(() => parseQuery(props.query), [props.query]);
  const [found, setFound] = useState<Found>({ status: "loading" });
  const [newestFirst, setNewestFirst] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setFound({ status: "loading" });
    if (!parsed.words) {
      setFound({ status: "done", messages: [] });
      setNewestFirst(true);
      return;
    }
    searchSpaceMessages(props.spaceId, parsed.words, controller.signal)
      .then((messages) => setFound({ status: "done", messages }))
      .catch(() => {
        if (!controller.signal.aborted) setFound({ status: "failed" });
      });
    return () => controller.abort();
  }, [props.spaceId, parsed.words, attempt]);
  const { whereSaid } = props;
  const messages = useMemo(() => {
    if (found.status !== "done") return [];
    const kept = found.messages.filter(
      (message) =>
        (!parsed.from || message.sender_name.toLowerCase().includes(parsed.from)) &&
        (!parsed.into || whereSaid(message).name.toLowerCase().includes(parsed.into)),
    );
    return [...kept].sort((left, right) =>
      newestFirst
        ? right.created_at.localeCompare(left.created_at)
        : left.created_at.localeCompare(right.created_at),
    );
  }, [found, newestFirst, parsed, whereSaid]);
  const terms = useMemo(
    () => parsed.words.toLowerCase().split(/\s+/).filter(Boolean),
    [parsed.words],
  );
  const avatars = useMemberAvatarUrls(props.spaceId, messages);
  const outlines = useMemberOutlines(props.spaceId, messages);
  const header = (
    <FramedBar
      start={
        <Text
          as="h2"
          size="control"
          weight="semibold"
          tone="bright"
          role="status"
          className="min-w-0 flex-1"
        >
          {found.status === "done"
            ? `${messages.length} ${messages.length === 1 ? "result" : "results"}`
            : "Search results"}
        </Text>
      }
    >
      {found.status === "done" && messages.length > 1 ? (
        <IconButton
          label={newestFirst ? "Newest first" : "Oldest first"}
          onClick={() => setNewestFirst((current) => !current)}
        >
          {newestFirst ? <ArrowDownWideNarrow /> : <ArrowUpNarrowWide />}
        </IconButton>
      ) : null}
      {props.onClose ? (
        <IconButton label="Close search" onClick={props.onClose}>
          <X />
        </IconButton>
      ) : null}
    </FramedBar>
  );
  const content = (
    <section aria-label="Search results" className="flex min-h-0 flex-1 flex-col">
      {found.status === "loading" ? (
        <SkeletonList
          label="Search results"
          rows={5}
          lines={2}
          leading="avatar-lg"
          className="px-2 pt-2"
        />
      ) : found.status === "failed" ? (
        <ErrorState
          inline
          title="Search didn’t finish"
          action={{
            label: "Try again",
            variant: "secondary",
            onClick: () => setAttempt((n) => n + 1),
          }}
        />
      ) : !messages.length ? (
        <EmptyState inline title="Nothing matches" line="Try other words." />
      ) : (
        <div className="misty-scrollbar-flush min-h-0 flex-1 overflow-y-auto pt-1 pb-4">
          {messages.map((message, index) => {
            const where = whereSaid(message);
            const previous = messages[index - 1];
            const newChannel = !previous || whereSaid(previous).name !== where.name;
            return (
              <Fragment key={message.id}>
                {newChannel ? (
                  <div className="flex h-8 items-center gap-1.5 px-4 pt-3">
                    {where.direct ? (
                      <ChatAvatar
                        id={message.conversation_id ?? where.name}
                        name={where.name}
                        size="xs"
                      />
                    ) : (
                      <Text bare tone="muted">
                        <Hash aria-hidden="true" />
                      </Text>
                    )}
                    <Text size="meta" weight="semibold" tone="muted" className="min-w-0">
                      {where.name}
                    </Text>
                  </div>
                ) : null}
                <ChannelMessage
                  role="button"
                  tabIndex={0}
                  className="cursor-pointer"
                  onClick={() => props.onOpen(message)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") props.onOpen(message);
                  }}
                  name={message.sender_name}
                  color={props.colorOf(message)}
                  avatar={
                    <ChatAvatar
                      id={message.sender_user_id || message.sender_name}
                      name={message.sender_name}
                      size="lg"
                      src={
                        message.origin?.author_avatar_url ||
                        avatars.get(message.sender_user_id) ||
                        undefined
                      }
                      outline={memberOutlineFor(outlines, message)}
                    />
                  }
                  time={stampFormat.format(new Date(message.created_at))}
                  dateTime={message.created_at}
                >
                  <ChannelMessageText>
                    <Highlighted text={spansToText(message.content)} terms={terms} />
                  </ChannelMessageText>
                </ChannelMessage>
              </Fragment>
            );
          })}
        </div>
      )}
    </section>
  );
  return { header, content };
}

function Highlighted(props: { text: string; terms: string[] }) {
  if (!props.terms.length) return <>{props.text}</>;
  const pattern = new RegExp(
    `(${props.terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "gi",
  );
  return (
    <>
      {props.text
        .split(pattern)
        .map((part, index) =>
          index % 2 ? (
            <CommandPaletteMatch key={index}>{part}</CommandPaletteMatch>
          ) : (
            <Fragment key={index}>{part}</Fragment>
          ),
        )}
    </>
  );
}
