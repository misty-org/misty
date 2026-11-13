import {
  CaseSensitive,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Regex,
  TextSelect,
  WholeWord,
  X,
  type LucideIcon,
} from "lucide-react";
import type { KeyboardEvent, ReactNode, Ref } from "react";
import { Button } from "../controls/Button";
import { IconButton } from "../controls/IconButton";
import { Input } from "../controls/Input";
import { Text } from "../display/Text";
import { ActionBar, type ActionBarItem } from "../layout/ActionBar";
import { iconBarItem, type IconBarItemOptions } from "../layout/IconBarItem";

/** A press on the bar's buttons keeps focus in its field, so typing carries on. */
function keepFindInputFocus(event: { preventDefault(): void }) {
  event.preventDefault();
}

const findItem = (item: IconBarItemOptions) =>
  iconBarItem({ ...item, onMouseDown: keepFindInputFocus });

/** One of the bar's fields: the find text, or the replacement. */
export interface FindBarFieldProps {
  value: string;
  onChange(value: string): void;
  inputRef?: Ref<HTMLInputElement>;
  onKeyDown?(event: KeyboardEvent<HTMLInputElement>): void;
  onCompositionStart?(): void;
  onCompositionEnd?(): void;
}

/** The replace row, for a document that can be edited. */
export interface FindBarReplaceProps extends FindBarFieldProps {
  open: boolean;
  onToggle(): void;
  canReplace: boolean;
  onReplace(): void;
  onReplaceAll(): void;
}

export interface FindBarProps {
  /** The search region's accessible name, e.g. "Find in document". */
  label: string;
  hidden?: boolean;
  find: FindBarFieldProps;
  /** Each search option shows only when its handler is given. */
  caseSensitive?: boolean;
  onCaseSensitive?(): void;
  wholeWord?: boolean;
  onWholeWord?(): void;
  regex?: boolean;
  onRegex?(): void;
  /** Where the search is, as `2/7`; `0/0` when nothing matches. */
  count: string;
  /** Typed, with nothing found: the field and the count say so. */
  empty: boolean;
  canStep: boolean;
  onPrevious(): void;
  onNext(): void;
  /** Selects every match, where the document can (a code editor). */
  onSelectAll?(): void;
  onClose(): void;
  onKeyDown?(event: KeyboardEvent<HTMLDivElement>): void;
  replace?: FindBarReplaceProps;
}

function FindField(props: FindBarFieldProps & { placeholder: string; invalid?: boolean }) {
  return (
    <Input
      ref={props.inputRef}
      className="min-w-16 flex-1"
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
      onKeyDown={props.onKeyDown}
      onCompositionStart={props.onCompositionStart}
      onCompositionEnd={props.onCompositionEnd}
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck={false}
      placeholder={props.placeholder}
      aria-label={props.placeholder}
      aria-invalid={props.invalid || undefined}
    />
  );
}

function optionItems(props: FindBarProps): ActionBarItem[] {
  const options: Array<
    [string, LucideIcon, string, boolean | undefined, (() => void) | undefined]
  > = [
    ["case", CaseSensitive, "Match case", props.caseSensitive, props.onCaseSensitive],
    ["word", WholeWord, "Whole word", props.wholeWord, props.onWholeWord],
    ["regex", Regex, "Regular expression", props.regex, props.onRegex],
  ];
  return options.flatMap(([id, icon, label, pressed, onSelect]) =>
    onSelect
      ? [findItem({ id, icon, label, priority: 1, pressed: Boolean(pressed), onSelect })]
      : [],
  );
}

/**
 * Find (and replace) docked at the top of a document: a flat row under a hairline with the field,
 * case, whole word and pattern toggles, where the search is (`2/7`), stepping and close. The
 * toggles fold into ⋯ first when the pane is narrow, then select all, then stepping.
 *
 * ```tsx
 * <FindBar label="Find in document" find={{ value: query, onChange: setQuery }}
 *   caseSensitive={matchCase} onCaseSensitive={() => setMatchCase(!matchCase)}
 *   count={`${cursor + 1}/${total}`} empty={total === 0} canStep={total > 0}
 *   onPrevious={previous} onNext={next} onClose={close} />
 * ```
 */
export function FindBar(props: FindBarProps) {
  const items = optionItems(props);
  if (props.onSelectAll) {
    items.push(
      findItem({
        id: "all",
        icon: TextSelect,
        label: "Select all matches",
        priority: 2,
        disabled: !props.canStep,
        onSelect: props.onSelectAll,
      }),
    );
  }
  items.push(
    findItem({
      id: "previous",
      icon: ChevronUp,
      label: "Previous match",
      shortcut: "⇧↵",
      priority: 3,
      disabled: !props.canStep,
      onSelect: props.onPrevious,
    }),
    findItem({
      id: "next",
      icon: ChevronDown,
      label: "Next match",
      shortcut: "↵",
      priority: 3,
      disabled: !props.canStep,
      onSelect: props.onNext,
    }),
  );
  const end: ReactNode = (
    <>
      <span role="status" aria-live="polite" className="flex items-center">
        <Text size="meta" tone={props.empty ? "danger" : "muted"} className="tabular-nums">
          {props.count}
        </Text>
      </span>
      <IconButton
        label="Close"
        shortcut="Esc"
        onMouseDown={keepFindInputFocus}
        onClick={props.onClose}
      >
        <X />
      </IconButton>
    </>
  );
  const replace = props.replace;
  return (
    <div
      role="search"
      aria-label={props.label}
      hidden={props.hidden}
      onKeyDown={props.onKeyDown}
      className="flex flex-none flex-col gap-1 border-b px-2 py-2"
    >
      <div className="flex min-w-0 items-center gap-1">
        {replace ? (
          <IconButton
            label={replace.open ? "Hide replace" : "Show replace"}
            aria-expanded={replace.open}
            onMouseDown={keepFindInputFocus}
            onClick={replace.onToggle}
          >
            {replace.open ? <ChevronDown /> : <ChevronRight />}
          </IconButton>
        ) : null}
        <FindField {...props.find} placeholder="Find" invalid={props.empty} />
        <ActionBar label="Find options" width="content" items={items} end={end} />
      </div>
      {replace?.open ? (
        <div className="flex min-w-0 items-center gap-1">
          <span aria-hidden className="size-8 flex-none" />
          <FindField {...replace} placeholder="Replace" />
          <Button
            variant="secondary"
            disabled={!replace.canReplace}
            onMouseDown={keepFindInputFocus}
            onClick={replace.onReplace}
          >
            Replace
          </Button>
          <Button
            variant="secondary"
            disabled={!replace.canReplace}
            onMouseDown={keepFindInputFocus}
            onClick={replace.onReplaceAll}
          >
            Replace all
          </Button>
        </div>
      ) : null}
    </div>
  );
}
