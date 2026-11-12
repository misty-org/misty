// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { ChevronDown, ChevronUp, TextSelect, X } from "lucide-react";
import { IconButton } from "@/shared/ui";

/** A press on the card's buttons keeps focus in its field, so typing carries on. */
export function keepFindInputFocus(event: { preventDefault(): void }) {
  event.preventDefault();
}

export type FindOption = "caseSensitive" | "wholeWord" | "regexp";

/** How the query matches, inside the find field: case, whole words, a regular expression. */
export function FindToggles(props: {
  caseSensitive: boolean;
  wholeWord: boolean;
  regexp: boolean;
  onToggle(option: FindOption): void;
}) {
  const toggles: [FindOption, string, string, boolean, string][] = [
    ["caseSensitive", "Match case", "Aa", props.caseSensitive, "editor-find-toggle"],
    ["wholeWord", "Whole word", "W", props.wholeWord, "editor-find-toggle"],
    ["regexp", "Regular expression", ".*", props.regexp, "editor-find-toggle font-mono"],
  ];
  return (
    <>
      {toggles.map(([option, label, glyph, pressed, className]) => (
        <IconButton
          key={option}
          label={label}
          size="sm"
          className={className}
          aria-pressed={pressed}
          onMouseDown={keepFindInputFocus}
          onClick={() => props.onToggle(option)}
        >
          {glyph}
        </IconButton>
      ))}
    </>
  );
}

/** Stepping through the matches and closing the card; selecting every match where it can. */
export function FindSteps(props: {
  disabled: boolean;
  onStep(direction: "prev" | "next"): void;
  onClose(): void;
  onSelectAll?(): void;
}) {
  return (
    <>
      {props.onSelectAll ? (
        <IconButton
          label="Select all matches"
          size="sm"
          disabled={props.disabled}
          onMouseDown={keepFindInputFocus}
          onClick={props.onSelectAll}
        >
          <TextSelect />
        </IconButton>
      ) : null}
      <IconButton
        label="Previous match (Shift+Enter)"
        size="sm"
        disabled={props.disabled}
        onMouseDown={keepFindInputFocus}
        onClick={() => props.onStep("prev")}
      >
        <ChevronUp />
      </IconButton>
      <IconButton
        label="Next match (Enter)"
        size="sm"
        disabled={props.disabled}
        onMouseDown={keepFindInputFocus}
        onClick={() => props.onStep("next")}
      >
        <ChevronDown />
      </IconButton>
      <IconButton
        label="Close (Esc)"
        size="sm"
        onMouseDown={keepFindInputFocus}
        onClick={props.onClose}
      >
        <X />
      </IconButton>
    </>
  );
}
