// SPDX-License-Identifier: AGPL-3.0-or-later
// Adapted from Fluxer (https://github.com/fluxerapp/fluxer): features/expressions/components/
// popouts/ExpressionPickerPopout.tsx, features/channel/components/EmojiPicker.tsx and emoji_picker/
// (EmojiPickerCategoryList, EmojiPickerInspector, SkinToneSelector), shared/PickerSearchInput.tsx
// and pickers/shared/PickerCategoryHeaderRow.tsx, with their CSS. Misty has emoji only, so the
// popout has no tabs, as Fluxer's does with a single tab.
import { useMemo, useRef, useState, type ReactElement } from "react";
import * as Popover from "@radix-ui/react-popover";
import {
  Bike,
  Utensils,
  ChevronDown,
  Clock,
  Flag,
  Gamepad2,
  Heart,
  Leaf,
  Lightbulb,
  Search,
  Smile,
  Frown,
  X,
  type LucideIcon,
} from "lucide-react";
import { FluxerScroller } from "./FluxerScroller";
import { FluxerTooltip } from "./FluxerTooltip";
import { Twemoji, twemojiUrl } from "./Twemoji";
import {
  allNames,
  emojiCategoryLabels,
  findEmoji,
  rememberEmoji,
  searchEmoji,
  skinToneLabels,
  skinToneModifiers,
  useEmojiData,
  useFrequentEmoji,
  useSkinTone,
  withSkinTone,
  type EmojiCategoryKey,
  type FluxerEmoji,
} from "./emojiData";
import { cx } from "./cx";
import popout from "./css/ExpressionPickerPopout.module.css";
import styles from "./css/EmojiPicker.module.css";
import form from "./css/FormInput.module.css";
import search from "./css/PickerSearchInput.module.css";
import shell from "./css/SpaceChatShell.module.css";

const categoryIcons: Record<EmojiCategoryKey, LucideIcon> = {
  people: Smile,
  nature: Leaf,
  food: Utensils,
  activity: Gamepad2,
  travel: Bike,
  objects: Lightbulb,
  symbols: Heart,
  flags: Flag,
};

/** EXPRESSION_PICKER_DEFAULT_SIZE; the grid then holds 11 columns of 48px. */
const SIZE = { width: 592, height: 690 };

/**
 * The emoji picker in its popout. From the composer it opens above its button, right edges lined
 * up (`top`/`end`); from a message's action bar, to the left of it (`left`/`start`); from the +
 * after reactions, to the right (`right`/`start`).
 */
export function FluxerEmojiPicker(props: {
  children: ReactElement;
  onSelect(emoji: string): void;
  side?: "top" | "left" | "right";
  align?: "start" | "end";
  /** Opens it from elsewhere too, such as the message menu's Add reaction. */
  open?: boolean;
  onOpenChange?(open: boolean): void;
}) {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = props.open ?? ownOpen;
  const change = (next: boolean) => {
    setOwnOpen(next);
    props.onOpenChange?.(next);
  };
  return (
    <Popover.Root open={open} onOpenChange={change}>
      <Popover.Trigger asChild>{props.children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side={props.side ?? "top"}
          align={props.align ?? "end"}
          sideOffset={8}
          alignOffset={props.side === "top" || !props.side ? -16 : 0}
          collisionPadding={16}
          aria-label="Emoji picker"
          className={cx("fluxer-chat", shell.popoutShadow)}
          style={{
            zIndex: 60,
            width: `min(${SIZE.width}px, calc(100vw - 32px))`,
            height: `min(${SIZE.height}px, calc(100vh - 32px))`,
          }}
        >
          <EmojiPickerBody
            onPick={(emoji, keepOpen) => {
              rememberEmoji(emoji);
              props.onSelect(emoji);
              if (!keepOpen) change(false);
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

type Section = { key: string; title: string; icon?: LucideIcon; emojis: FluxerEmoji[] };

function EmojiPickerBody(props: { onPick(emoji: string, keepOpen: boolean): void }) {
  const all = useEmojiData();
  const frequent = useFrequentEmoji((state) => state.value);
  const tone = useSkinTone((state) => state.value);
  const setTone = useSkinTone((state) => state.set);
  // The frequent order is pinned when the picker opens, so it doesn't shuffle while in use.
  const pinnedFrequent = useRef(frequent);
  const [query, setQuery] = useState("");
  const [hovered, setHovered] = useState<FluxerEmoji | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const scroller = useRef<HTMLDivElement>(null);
  const sections = useMemo<Section[]>(() => {
    if (!all) return [];
    const recent = pinnedFrequent.current
      .map((emoji) => findEmoji(all, emoji))
      .filter((emoji): emoji is FluxerEmoji => Boolean(emoji));
    const out: Section[] = [];
    if (recent.length)
      out.push({ key: "frequent", title: "Frequently used", icon: Clock, emojis: recent });
    for (const key of Object.keys(emojiCategoryLabels) as EmojiCategoryKey[])
      out.push({ key, title: emojiCategoryLabels[key], emojis: all[key] ?? [] });
    return out;
  }, [all]);
  const results = useMemo(
    () => (all && query.trim() ? searchEmoji(all, query, pinnedFrequent.current) : null),
    [all, query],
  );
  const pick = (emoji: FluxerEmoji, keepOpen: boolean) =>
    props.onPick(withSkinTone(emoji, tone), keepOpen);
  const cell = (emoji: FluxerEmoji, key: string) => (
    <button
      key={key}
      type="button"
      role="option"
      tabIndex={-1}
      aria-label={emoji.names[0]?.replace(/_/g, " ")}
      aria-selected={hovered === emoji}
      className={cx(styles.emojiRenderer)}
      onMouseEnter={() => setHovered(emoji)}
      onClick={(event) => pick(emoji, event.shiftKey)}
    >
      <EmojiGlyph emoji={withSkinTone(emoji, tone)} />
    </button>
  );
  const jump = (key: string) => {
    const header = scroller.current?.querySelector<HTMLElement>(`[data-section="${key}"]`);
    if (header && scroller.current) scroller.current.scrollTop = header.offsetTop - 12;
  };
  return (
    <div
      className={cx(popout.container, popout.containerNoTabs)}
      style={{ width: "100%", height: "100%" }}
    >
      <div className={popout.header}>
        <div className={popout.headerPortal}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div className={search.searchInputContainer}>
              <div className={form.inputWrapper} style={{ flex: 1 }}>
                <span className={form.leftIcon}>
                  <Search size={18} />
                </span>
                <input
                  autoFocus
                  type="text"
                  maxLength={100}
                  aria-label="Search emoji"
                  placeholder={hovered ? allNames(hovered) : "Find the emoji of your dreams"}
                  value={query}
                  className={cx(
                    form.input,
                    form.minHeight,
                    form.hasRightElement,
                    form.hasLeftIcon,
                    form.focusable,
                    search.searchInput,
                  )}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && results?.[0]) {
                      event.preventDefault();
                      pick(results[0], event.shiftKey);
                    }
                  }}
                />
                <div className={form.rightElement}>
                  {query ? (
                    <button
                      type="button"
                      aria-label="Clear search"
                      className={search.clearButton}
                      onClick={() => setQuery("")}
                    >
                      <X size={18} />
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
            <SkinToneSelector tone={tone} onTone={setTone} />
          </div>
        </div>
      </div>
      <div className={popout.content}>
        <div className={styles.emojiPicker}>
          <nav aria-label="Emoji categories" className={styles.categoryList}>
            <div className={styles.categoryListScroll}>
              <div className={styles.listItems}>
                {results
                  ? null
                  : sections.map((section) => {
                      const Glyph =
                        section.key === "frequent"
                          ? Clock
                          : categoryIcons[section.key as EmojiCategoryKey];
                      return (
                        <FluxerTooltip key={section.key} content={section.title} side="left">
                          <button
                            type="button"
                            aria-label={section.title}
                            className={cx(styles.categoryListIcon, styles.textPrimaryMuted)}
                            onClick={() => jump(section.key)}
                          >
                            <Glyph className={styles.iconSize} />
                          </button>
                        </FluxerTooltip>
                      );
                    })}
              </div>
            </div>
          </nav>
          <div className={styles.bodyWrapper}>
            <div className={styles.emojiPickerListWrapper}>
              <div className={styles.listWrapper}>
                <FluxerScroller ref={scroller} className={styles.list} fade={false} role="listbox">
                  {results ? (
                    results.length ? (
                      <div
                        className={cx(styles.emojiGrid, styles.emojiGridFixedTrack)}
                        style={{
                          gridTemplateColumns: "repeat(auto-fill, 48px)",
                          gridAutoFlow: "row",
                        }}
                      >
                        {results.slice(0, 500).map((emoji) => cell(emoji, emoji.surrogates))}
                      </div>
                    ) : null
                  ) : (
                    sections.map((section) => {
                      const shut = collapsed.has(section.key);
                      const Lead = section.icon;
                      return (
                        <div key={section.key} style={{ marginBottom: 12 }}>
                          <button
                            type="button"
                            data-section={section.key}
                            aria-expanded={!shut}
                            onClick={() =>
                              setCollapsed((current) => {
                                const next = new Set(current);
                                if (next.has(section.key)) next.delete(section.key);
                                else next.add(section.key);
                                return next;
                              })
                            }
                            style={{
                              height: 32,
                              display: "flex",
                              alignItems: "center",
                              paddingInline: 12,
                              marginBottom: 8,
                              cursor: "pointer",
                              border: "none",
                              background: "none",
                              width: "100%",
                              textAlign: "start",
                              gap: 8,
                              minWidth: 0,
                            }}
                          >
                            {Lead ? <Lead className={styles.headerIcon} /> : null}
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                flex: "1 1 auto",
                                minWidth: 0,
                              }}
                            >
                              <span
                                className={styles.categoryTitle}
                                style={{
                                  minWidth: 0,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                  flex: "0 1 auto",
                                }}
                              >
                                {section.title}
                              </span>
                              <ChevronDown
                                className={styles.caretIcon}
                                style={{
                                  transform: `rotate(${shut ? -90 : 0}deg)`,
                                  marginInlineStart: 8,
                                }}
                              />
                            </div>
                          </button>
                          {shut ? null : (
                            <div
                              className={cx(styles.emojiGrid, styles.emojiGridFixedTrack)}
                              style={{
                                gridTemplateColumns: "repeat(auto-fill, 48px)",
                                gridAutoFlow: "row",
                                gridAutoRows: 48,
                                contentVisibility: "auto",
                                containIntrinsicSize: "auto 480px",
                              }}
                            >
                              {section.emojis.map((emoji) =>
                                cell(emoji, `${section.key}:${emoji.surrogates}`),
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </FluxerScroller>
                {results && !results.length ? (
                  <div className={styles.emptyState}>
                    <div className={styles.emptyStateInner}>
                      <Frown className={styles.emptyIcon} />
                      <span className={styles.emptyLabel}>No emojis match that search</span>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
          <div className={styles.inspector}>
            {hovered ? (
              <>
                <EmojiGlyph emoji={withSkinTone(hovered, tone)} className={styles.inspectorEmoji} />
                <div className={styles.inspectorTextContainer}>
                  <div className={styles.inspectorText}>{allNames(hovered)}</div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/** A Twemoji glyph at the picker's 32px (spriteEmoji). */
function EmojiGlyph(props: { emoji: string; className?: string }) {
  return <Twemoji emoji={props.emoji} className={props.className ?? styles.spriteEmoji} />;
}

/** SkinToneSelector: a clapping-hands button that opens the six tones over itself. */
function SkinToneSelector(props: { tone: number; onTone(tone: number): void }) {
  const [open, setOpen] = useState(false);
  const order = [props.tone, ...[0, 1, 2, 3, 4, 5].filter((tone) => tone !== props.tone)];
  const clap = (tone: number) => twemojiUrl(`👏${skinToneModifiers[tone]}`);
  return (
    <div className={styles.skinToneSelectorContainer}>
      <button
        type="button"
        aria-label="Skin tone"
        aria-expanded={open}
        className={styles.skinTonePickerButton}
        style={{
          backgroundImage: `url(${clap(props.tone)})`,
          backgroundSize: "contain",
          backgroundRepeat: "no-repeat",
          border: "none",
          padding: 0,
          backgroundColor: "transparent",
        }}
        onClick={() => setOpen((current) => !current)}
      />
      {open ? (
        <div className={styles.skinTonePickerOptions} onMouseLeave={() => setOpen(false)}>
          {order.map((tone) => (
            <button
              key={tone}
              type="button"
              aria-label={skinToneLabels[tone]}
              aria-pressed={tone === props.tone}
              className={styles.skinTonePickerItem}
              style={{ border: "none", backgroundColor: "transparent" }}
              onClick={() => {
                props.onTone(tone);
                setOpen(false);
              }}
            >
              <img src={clap(tone)} alt="" className={styles.skinTonePickerItemImage} />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
