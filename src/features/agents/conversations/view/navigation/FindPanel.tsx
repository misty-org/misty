// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent, RefObject } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { IconButton, Input, Pressable } from "@/shared/ui";

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
  const toggle = (label: string, text: string, on: boolean, change: (value: boolean) => void) => (
    <Pressable
      className="chat-find-toggle"
      aria-pressed={on}
      aria-label={label}
      title={label}
      onMouseDown={keepFocus}
      onClick={() => change(!on)}
    >
      {text}
    </Pressable>
  );
  return (
    <div
      role="search"
      aria-label="Search in chat"
      className="chat-find"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        props.onClose();
      }}
    >
      <div className="chat-find-field">
        <Input
          variant="bare"
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
        {toggle("Match case", "Aa", props.caseSensitive, props.onCaseSensitiveChange)}
        {toggle("Whole word", "W", props.wholeWord, props.onWholeWordChange)}
        {toggle("Regular expression", ".*", props.useRegex, props.onUseRegexChange)}
      </div>
      <span
        role="status"
        aria-live="polite"
        className="chat-find-status"
        data-empty={hasQuery && !props.total ? true : undefined}
      >
        {status}
      </span>
      <IconButton
        size="sm"
        label="Previous match"
        disabled={!props.total}
        onMouseDown={keepFocus}
        onClick={props.onPrev}
      >
        <ChevronUp />
      </IconButton>
      <IconButton
        size="sm"
        label="Next match"
        disabled={!props.total}
        onMouseDown={keepFocus}
        onClick={props.onNext}
      >
        <ChevronDown />
      </IconButton>
      <IconButton size="sm" label="Close search" onMouseDown={keepFocus} onClick={props.onClose}>
        <X />
      </IconButton>
    </div>
  );
}
