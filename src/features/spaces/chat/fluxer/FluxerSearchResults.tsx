// SPDX-License-Identifier: AGPL-3.0-or-later
// Adapted from Fluxer (https://github.com/fluxerapp/fluxer): features/channel/components/
// ChannelSearchResults.tsx, channel_search_results/*, ChannelSearchHighlight.css and
// messaging/components/message_context_prefix/MessageContextPrefix.tsx, with their CSS. Results
// replace the member list; each sits in a bordered card under the channel it was said in, with
// Jump on hover. Misty's server matches the words; from: and in: narrow them here.
import { Fragment, useEffect, useMemo, useState } from "react";
import {
  CircleAlert,
  ClockArrowDown,
  ClockArrowUp,
  Hash,
  LoaderCircle,
  Search,
} from "lucide-react";
import type { SpaceMessage } from "../../api/dto/entities";
import { searchSpaceMessages } from "../../search/spaceSearch";
import { spansToText } from "../components/messageText";
import { FluxerScroller } from "./FluxerScroller";
import { FluxerAvatar } from "./FluxerAvatar";
import { FluxerTooltip } from "./FluxerTooltip";
import { cx } from "./cx";
import styles from "./css/ChannelSearchResults.module.css";
import prefix from "./css/MessageContextPrefix.module.css";
import m from "./css/Message.module.css";
import markup from "./css/Markup.module.css";

type Found =
  { status: "loading" } | { status: "done"; messages: SpaceMessage[] } | { status: "failed" };

/** Splits "from:alice in:general budget" into its filters and its words. */
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

export function FluxerSearchResults(props: {
  spaceId: string;
  query: string;
  whereSaid(message: SpaceMessage): { name: string; direct: boolean };
  colorOf(message: SpaceMessage): string | undefined;
  onOpen(message: SpaceMessage): void;
}) {
  const parsed = useMemo(() => parseQuery(props.query), [props.query]);
  const [found, setFound] = useState<Found>({ status: "loading" });
  const [newestFirst, setNewestFirst] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setFound({ status: "loading" });
    if (!parsed.words) {
      setFound({ status: "done", messages: [] });
      return;
    }
    searchSpaceMessages(props.spaceId, parsed.words, controller.signal)
      .then((messages) => setFound({ status: "done", messages }))
      .catch(() => {
        if (!controller.signal.aborted) setFound({ status: "failed" });
      });
    return () => controller.abort();
  }, [props.spaceId, parsed.words]);
  const messages = useMemo(() => {
    if (found.status !== "done") return [];
    const kept = found.messages.filter(
      (message) =>
        (!parsed.from || message.sender_name.toLowerCase().includes(parsed.from)) &&
        (!parsed.into || props.whereSaid(message).name.toLowerCase().includes(parsed.into)),
    );
    return [...kept].sort((left, right) =>
      newestFirst
        ? right.created_at.localeCompare(left.created_at)
        : left.created_at.localeCompare(right.created_at),
    );
  }, [found, newestFirst, parsed, props]);
  // Matched words are highlighted as Fluxer does (::highlight(channel-search-highlight)), in
  // Misty's waiting tone.
  const terms = useMemo(
    () => parsed.words.toLowerCase().split(/\s+/).filter(Boolean),
    [parsed.words],
  );
  const SortIcon = newestFirst ? ClockArrowDown : ClockArrowUp;
  return (
    <div className={styles.container} role="region" aria-label="Search results">
      <div className={styles.header}>
        <div className={styles.headerLoading}>
          {found.status === "loading" ? (
            <LoaderCircle
              size={16}
              className={styles.loadingIcon}
              style={{ width: 16, height: 16 }}
            />
          ) : null}
          <h2 className={styles.headerTitle} role="status">
            {found.status === "loading"
              ? "Searching"
              : found.status === "failed"
                ? "Search results"
                : `${messages.length} ${messages.length === 1 ? "result" : "results"}`}
          </h2>
        </div>
        {found.status === "done" ? (
          <div className={styles.headerActions}>
            <FluxerTooltip content={newestFirst ? "Newest" : "Oldest"}>
              <button
                type="button"
                aria-label={newestFirst ? "Sorted newest first" : "Sorted oldest first"}
                className={styles.sortButton}
                onClick={() => setNewestFirst((current) => !current)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: "var(--form-surface-background)",
                  border: "1px solid var(--background-modifier-accent)",
                  color: "var(--text-primary)",
                  cursor: "pointer",
                }}
              >
                <SortIcon size={18} />
              </button>
            </FluxerTooltip>
          </div>
        ) : null}
      </div>
      {found.status === "failed" ? (
        <div className={styles.errorState}>
          <CircleAlert size={80} style={{ color: "var(--text-primary-muted)" }} />
          <div className={styles.errorContent}>
            <div className={styles.errorHeading}>Error</div>
            <div className={styles.errorText}>An error occurred while searching.</div>
          </div>
        </div>
      ) : found.status === "done" && !messages.length ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyStateContent}>
            <Search size={80} className={styles.emptyStateIcon} />
            <div className={styles.emptyStateTextWrapper}>
              <div className={styles.emptyStateHeading}>No results</div>
              <div className={styles.emptyStateText}>Try a different search query.</div>
            </div>
          </div>
        </div>
      ) : (
        <FluxerScroller className={styles.resultsScroller} fade={false}>
          {messages.map((message, index) => {
            const where = props.whereSaid(message);
            const previous = messages[index - 1];
            const newChannel = !previous || props.whereSaid(previous).name !== where.name;
            const color = props.colorOf(message);
            return (
              <Fragment key={message.id}>
                {newChannel ? (
                  <div className={prefix.channelHeader}>
                    {where.direct ? (
                      <FluxerAvatar
                        id={message.conversation_id ?? where.name}
                        name={where.name}
                        size={20}
                      />
                    ) : (
                      <Hash className={prefix.channelIcon} />
                    )}
                    <button
                      type="button"
                      className={prefix.channelNameButton}
                      onClick={() => props.onOpen(message)}
                    >
                      <span className={prefix.channelNamePrimary}>{where.name}</span>
                    </button>
                  </div>
                ) : null}
                <div
                  className={styles.messageItem}
                  role="button"
                  tabIndex={0}
                  onClick={() => props.onOpen(message)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") props.onOpen(message);
                  }}
                >
                  <div className={m.message} style={{ marginInline: 0, paddingInlineEnd: 16 }}>
                    <div className={m.messageContent}>
                      <h3 className={m.messageAuthorInfo}>
                        <span className={m.messageAuthorRow}>
                          <span className={m.messageAuthorPart}>
                            <span className={m.messageAuthorName}>
                              <span
                                className={m.messageUsername}
                                style={color ? { color } : undefined}
                              >
                                {message.sender_name}
                              </span>
                            </span>
                          </span>
                          <span className={m.messageTimestamp}>
                            <time dateTime={message.created_at}>
                              {stampFormat.format(new Date(message.created_at))}
                            </time>
                          </span>
                        </span>
                      </h3>
                      <div className={cx(m.messageText, m.messageSent)}>
                        <div className={cx(markup.markup, "markup")}>
                          <Highlighted text={spansToText(message.content)} terms={terms} />
                        </div>
                      </div>
                    </div>
                    <div className={m.messageGutterLeft} />
                    <div className={m.messageAvatar}>
                      <FluxerAvatar
                        id={message.sender_user_id || message.sender_name}
                        name={message.sender_name}
                        size={40}
                      />
                    </div>
                    <div className={m.messageGutterRight} />
                  </div>
                  <div className={styles.actionButtons}>
                    <button type="button" className={styles.jumpButton}>
                      Jump
                    </button>
                  </div>
                </div>
              </Fragment>
            );
          })}
          <div className={styles.resultsSpacer} />
        </FluxerScroller>
      )}
    </div>
  );
}

/** The text with each searched word highlighted. */
function Highlighted(props: { text: string; terms: string[] }) {
  if (!props.terms.length) return <>{props.text}</>;
  const pattern = new RegExp(
    `(${props.terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "gi",
  );
  return (
    <>
      {props.text.split(pattern).map((part, index) =>
        index % 2 ? (
          <mark
            key={index}
            style={{
              backgroundColor: "color-mix(in srgb, var(--tone-waiting) 25%, transparent)",
              color: "inherit",
              borderRadius: 2,
            }}
          >
            {part}
          </mark>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}
