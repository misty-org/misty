// SPDX-License-Identifier: AGPL-3.0-or-later
// Adapted from Fluxer (https://github.com/fluxerapp/fluxer): features/channel/components/
// ChannelHeader.tsx, channel_header_components/ChannelHeaderIcon.tsx and message_search_bar/
// MessageSearchBar.tsx (+ HistorySection, FilterOption), with features/lexical/search/
// LexicalSearchInput's look on a plain input. Filters Misty can answer: from: and in:.
import { useRef, useState, type ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";
import {
  Clock,
  Funnel,
  Hash,
  Lock,
  Pin,
  Plus,
  Search,
  Trash2,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { createDeviceSetting } from "@/shared/lib/deviceSetting";
import { FluxerTooltip } from "./FluxerTooltip";
import { FluxerAvatar } from "./FluxerAvatar";
import { cx } from "./cx";
import styles from "./css/ChannelHeader.module.css";
import search from "./css/MessageSearchBar.module.css";
import editor from "./css/LexicalSearchInput.module.css";
import shell from "./css/SpaceChatShell.module.css";

/** Recent searches, newest first (features/search/state/SearchHistory.ts keeps five on show). */
const useSearchHistory = createDeviceSetting<string[]>({
  scope: "spaces.chat.search-history",
  defaults: [],
  normalize: (stored) =>
    Array.isArray(stored)
      ? stored.filter((item): item is string => typeof item === "string").slice(0, 20)
      : [],
});

const filters = [
  { key: "from:", description: "a user" },
  { key: "in:", description: "a channel" },
];

/** ChannelHeaderIcon: a 32px button with a 24px glyph that only brightens. */
function HeaderIcon(props: {
  label: string;
  icon: LucideIcon;
  selected?: boolean;
  onClick(): void;
}) {
  const Glyph = props.icon;
  return (
    <FluxerTooltip content={props.label} side="bottom">
      <button
        type="button"
        aria-label={props.label}
        aria-pressed={props.selected}
        className={props.selected ? styles.iconButtonSelected : styles.iconButtonDefault}
        onClick={props.onClick}
      >
        <Glyph className={styles.buttonIcon} />
      </button>
    </FluxerTooltip>
  );
}

/**
 * The channel's bar: its # (or the person's face in a direct message) and name, then the pin to
 * Misty's sidebar, the member list toggle and the search box.
 */
export function FluxerChannelHeader(props: {
  name: string;
  /** A direct message: the other person, shown by their face. */
  direct?: { id: string; name: string };
  locked: boolean;
  membersShown: boolean;
  onToggleMembers(): void;
  pinned?: boolean;
  onTogglePin?: () => void;
  /** Runs a search, or clears it with "". */
  onSearch(query: string): void;
  searchQuery: string;
}) {
  const ChannelGlyph = props.locked ? Lock : Hash;
  return (
    <header className={styles.headerWrapper}>
      <div className={styles.headerContainer}>
        <div className={styles.headerLeftSection}>
          <div className={styles.leftContentContainer}>
            <div role="group" className={styles.channelInfoContainer}>
              {props.direct ? (
                <div className={styles.dmNameWrapper}>
                  <FluxerAvatar id={props.direct.id} name={props.direct.name} size={32} />
                  <span className={cx(styles.channelName, styles.groupDmChannelName)}>
                    {props.name}
                  </span>
                </div>
              ) : (
                <>
                  <ChannelGlyph className={styles.channelIcon} />
                  <h1 className={styles.channelName} style={{ fontSize: "inherit" }}>
                    {props.name}
                  </h1>
                </>
              )}
            </div>
          </div>
        </div>
        <div role="group" aria-label="Channel actions" className={styles.headerRightSection}>
          {props.onTogglePin ? (
            <HeaderIcon
              label={props.pinned ? "Unpin from sidebar" : "Pin to sidebar"}
              icon={Pin}
              selected={props.pinned}
              onClick={props.onTogglePin}
            />
          ) : null}
          <HeaderIcon
            label={props.membersShown ? "Hide members" : "Show members"}
            icon={Users}
            selected={props.membersShown}
            onClick={props.onToggleMembers}
          />
          <div className={styles.messageSearchFocusWrapper}>
            <MessageSearchBar query={props.searchQuery} onSearch={props.onSearch} />
          </div>
        </div>
      </div>
    </header>
  );
}

/** MessageSearchBar: the 244×36 box, and its popout of filters and recent searches on focus. */
function MessageSearchBar(props: { query: string; onSearch(query: string): void }) {
  const [text, setText] = useState(props.query);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const history = useSearchHistory((state) => state.value);
  const setHistory = useSearchHistory((state) => state.set);
  const recent = history.slice(0, 5);
  const options: { kind: "filter" | "history"; value: string }[] = [
    ...filters.map((filter) => ({ kind: "filter" as const, value: filter.key })),
    ...recent.map((value) => ({ kind: "history" as const, value })),
  ];
  const run = (query: string) => {
    const words = query.trim();
    setText(words);
    setOpen(false);
    props.onSearch(words);
    if (words) setHistory((current) => [words, ...current.filter((item) => item !== words)]);
  };
  const pick = (option: (typeof options)[number]) => {
    if (option.kind === "history") return run(option.value);
    setText((current) => `${current.trim() ? `${current.trim()} ` : ""}${option.value}`);
    requestAnimationFrame(() => input.current?.focus());
  };
  const clear = () => {
    setText("");
    props.onSearch("");
    input.current?.focus();
  };
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <div className={search.anchor}>
          <div className={search.inputContainer}>
            <span className={search.scopeButton} aria-hidden="true">
              <Search className={search.searchIcon} />
            </span>
            <div className={editor.editorShell}>
              <input
                ref={input}
                type="text"
                role="combobox"
                aria-expanded={open}
                aria-label="Search messages"
                autoComplete="off"
                spellCheck={false}
                value={text}
                className={editor.editable}
                style={{ border: "none", background: "transparent", padding: 0 }}
                onFocus={() => setOpen(true)}
                onChange={(event) => {
                  setText(event.target.value);
                  setActive(-1);
                  setOpen(true);
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    setOpen(true);
                    const step = event.key === "ArrowDown" ? 1 : -1;
                    setActive((current) => (current + step + options.length) % options.length);
                  } else if (event.key === "Enter") {
                    event.preventDefault();
                    const option = open ? options[active] : undefined;
                    if (option) pick(option);
                    else run(text);
                  } else if (event.key === "Escape") {
                    if (text) {
                      event.preventDefault();
                      clear();
                    } else setOpen(false);
                  }
                }}
              />
              {text ? null : <span className={editor.placeholder}>Search messages</span>}
            </div>
            {text ? (
              <button
                type="button"
                aria-label="Clear search"
                className={search.clearButton}
                onMouseDown={(event) => event.preventDefault()}
                onClick={clear}
              >
                <X className={search.optionMetaIcon} />
              </button>
            ) : null}
          </div>
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={8}
          collisionPadding={16}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onPointerDown={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            if (input.current?.contains(event.target as Node)) event.preventDefault();
          }}
          className={cx("fluxer-chat", search.popoutContainer, shell.popoutMotion)}
          style={{ width: 380, zIndex: 50 }}
        >
          <div className={search.popoutInner}>
            <div role="listbox" aria-label="Search suggestions" className={search.list}>
              <Section icon={<Funnel size={12} />} title="Search filters">
                {filters.map((filter, index) => (
                  <Option
                    key={filter.key}
                    active={active === index}
                    onHover={() => setActive(index)}
                    onPick={() => pick(options[index]!)}
                  >
                    <span className={search.optionTitle}>
                      <span className={search.searchFilter}>{filter.key}</span>
                      <span className={search.optionDescription}>{filter.description}</span>
                    </span>
                  </Option>
                ))}
              </Section>
              {recent.length ? (
                <Section
                  icon={<Clock size={12} />}
                  title="Recent searches"
                  action={
                    <button
                      type="button"
                      className={cx(search.flex, search.itemsCenter)}
                      style={{ gap: 4 }}
                      onClick={() => setHistory([])}
                    >
                      <Trash2 size={10} /> Clear
                    </button>
                  }
                >
                  {recent.map((value, index) => (
                    <Option
                      key={value}
                      active={active === filters.length + index}
                      onHover={() => setActive(filters.length + index)}
                      onPick={() => run(value)}
                    >
                      <span className={cx(search.optionTitle, search.historyOptionTitle)}>
                        {value}
                      </span>
                    </Option>
                  ))}
                </Section>
              ) : null}
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Section(props: {
  icon: ReactNode;
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={search.popoutSection}>
      <div className={search.popoutSectionHeader}>
        <span className={cx(search.flex, search.itemsCenter)} style={{ gap: 8 }}>
          {props.icon}
          {props.title}
        </span>
        {props.action}
      </div>
      {props.children}
    </div>
  );
}

function Option(props: { active: boolean; onHover(): void; onPick(): void; children: ReactNode }) {
  return (
    <div
      role="option"
      aria-selected={props.active}
      className={cx(search.option, props.active && search.optionActive)}
      onMouseEnter={props.onHover}
      onClick={props.onPick}
    >
      <div className={search.optionLabel}>
        <div className={search.optionContent}>
          <div className={search.optionText}>{props.children}</div>
        </div>
      </div>
      <Plus className={cx(search.optionMetaIcon, !props.active && search.optionMetaIconInactive)} />
    </div>
  );
}
