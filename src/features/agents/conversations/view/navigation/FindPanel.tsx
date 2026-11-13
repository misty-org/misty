// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent, RefObject } from "react";
import { CaseSensitive, ChevronDown, ChevronUp, Regex, WholeWord, X } from "lucide-react";
import { ActionBar, IconButton, iconBarItem, Input, Surface, Text } from "@/shared/ui";

/** Keeps focus in the field when a button beside it is pressed. */
const keepFocus = (event: MouseEvent) => event.preventDefault();

/**
 * The find card over the transcript: the query with case, whole-word and regexp toggles, "3/12",
 * and previous, next and close. Enter goes to the next match and Shift+Enter to the previous;
 * Escape closes.
 */
export function FindPanel(props: {
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  onQueryChange: (value: string) => void;
  caseSensitive: boolean;
  onCaseSensitiveChange: (value: boolean) => void;
  wholeWord: boolean;
  onWholeWordChange: (value: boolean) => void;
  useRegex: boolean;
  onUseRegexChange: (value: boolean) => void;
  /** 1-based current match; 0 when there is none. */
  current: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const hasQuery = props.query.length > 0;
  const status =
    hasQuery && props.total > 0 ? `${props.current}/${props.total}` : hasQuery ? "No results" : "";
  const onInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      props.onClose();
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) props.onPrev();
      else props.onNext();
    }
  };
  const toggle = (
    id: string,
    icon: typeof CaseSensitive,
    label: string,
    on: boolean,
    change: (value: boolean) => void,
  ) =>
    iconBarItem({
      id,
      icon,
      label,
      size: "sm",
      priority: 1,
      pressed: on,
      onMouseDown: keepFocus,
      onSelect: () => change(!on),
    });
  return (
    <Surface
      role="search"
      aria-label="Search in chat"
      tone="card"
      edge="hairline"
      radius="xl"
      raised
      className={
        "absolute top-[calc(var(--agent-conversation-inset,0px)+0.75rem)] right-4 " +
        "z-[var(--stack-float)] flex items-center gap-0.5 p-1"
      }
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        props.onClose();
      }}
    >
      <Surface
        tone="page"
        edge="field"
        radius="lg"
        className="flex h-7 items-center gap-0.5 pr-1 pl-2"
      >
        <Input
          variant="bare"
          className="w-45 text-meta"
          ref={props.inputRef}
          value={props.query}
          onChange={(event) => props.onQueryChange(event.target.value)}
          onKeyDown={onInputKeyDown}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Search in chat"
          aria-label="Search in chat"
        />
        <ActionBar
          label="Search options"
          size="sm"
          width="content"
          items={[
            toggle(
              "case",
              CaseSensitive,
              "Match case",
              props.caseSensitive,
              props.onCaseSensitiveChange,
            ),
            toggle("word", WholeWord, "Whole word", props.wholeWord, props.onWholeWordChange),
            toggle("regex", Regex, "Regular expression", props.useRegex, props.onUseRegexChange),
          ]}
        />
      </Surface>
      <Text
        role="status"
        aria-live="polite"
        size="caption"
        tone="muted"
        className="min-w-16 px-1 text-center tabular-nums"
        data-empty={hasQuery && !props.total ? true : undefined}
      >
        {status}
      </Text>
      <ActionBar
        label="Find steps"
        size="sm"
        width="content"
        items={[
          iconBarItem({
            id: "previous",
            icon: ChevronUp,
            label: "Previous match",
            size: "sm",
            priority: 1,
            disabled: !props.total,
            onMouseDown: keepFocus,
            onSelect: props.onPrev,
          }),
          iconBarItem({
            id: "next",
            icon: ChevronDown,
            label: "Next match",
            size: "sm",
            priority: 1,
            disabled: !props.total,
            onMouseDown: keepFocus,
            onSelect: props.onNext,
          }),
        ]}
        end={
          <IconButton
            size="sm"
            label="Close search"
            onMouseDown={keepFocus}
            onClick={props.onClose}
          >
            <X />
          </IconButton>
        }
      />
    </Surface>
  );
}
