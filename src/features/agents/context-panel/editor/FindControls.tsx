// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import {
  CaseSensitive,
  ChevronDown,
  ChevronUp,
  Regex,
  TextSelect,
  WholeWord,
  X,
  type LucideIcon,
} from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";
import {
  ActionBar,
  IconButton,
  iconBarItem,
  Surface,
  Text,
  type IconBarItemOptions,
} from "@/shared/ui";

/** A press on the card's buttons keeps focus in its field, so typing carries on. */
export function keepFindInputFocus(event: { preventDefault(): void }) {
  event.preventDefault();
}

/** The card is a compact 24px bar: every control in it is the small size. */
const findItem = (item: Omit<IconBarItemOptions, "size" | "onMouseDown">) =>
  iconBarItem({ ...item, size: "sm", onMouseDown: keepFindInputFocus });

type FindOption = "caseSensitive" | "wholeWord" | "regexp";

/** How the query matches, inside the find field: case, whole words, a regular expression. */
export function FindToggles(props: {
  caseSensitive: boolean;
  wholeWord: boolean;
  regexp: boolean;
  onToggle(option: FindOption): void;
}) {
  const toggles: [FindOption, string, LucideIcon, boolean][] = [
    ["caseSensitive", "Match case", CaseSensitive, props.caseSensitive],
    ["wholeWord", "Whole word", WholeWord, props.wholeWord],
    ["regexp", "Regular expression", Regex, props.regexp],
  ];
  return (
    <ActionBar
      label="Find options"
      size="sm"
      width="content"
      items={toggles.map(([option, label, icon, pressed]) =>
        findItem({
          id: option,
          icon,
          label,
          priority: 1,
          pressed,
          onSelect: () => props.onToggle(option),
        }),
      )}
    />
  );
}

/** Stepping through the matches and closing the card; selecting every match where it can. */
export function FindSteps(props: {
  disabled: boolean;
  onStep(direction: "prev" | "next"): void;
  onClose(): void;
  onSelectAll?(): void;
}) {
  const onSelectAll = props.onSelectAll;
  return (
    <ActionBar
      label="Find steps"
      size="sm"
      width="content"
      items={[
        ...(onSelectAll
          ? [
              findItem({
                id: "all",
                icon: TextSelect,
                label: "Select all matches",
                priority: 1,
                disabled: props.disabled,
                onSelect: onSelectAll,
              }),
            ]
          : []),
        findItem({
          id: "previous",
          icon: ChevronUp,
          label: "Previous match (Shift+Enter)",
          priority: 2,
          disabled: props.disabled,
          onSelect: () => props.onStep("prev"),
        }),
        findItem({
          id: "next",
          icon: ChevronDown,
          label: "Next match (Enter)",
          priority: 2,
          disabled: props.disabled,
          onSelect: () => props.onStep("next"),
        }),
      ]}
      end={
        <IconButton
          label="Close (Esc)"
          size="sm"
          onMouseDown={keepFindInputFocus}
          onClick={props.onClose}
        >
          <X />
        </IconButton>
      }
    />
  );
}

/** The find card, floating over the document's top right: its rows stacked, find over replace. */
export function FindCard(props: HTMLAttributes<HTMLElement>) {
  return (
    <Surface
      {...props}
      tone="card"
      edge="hairline"
      radius="lg"
      raised
      className="absolute top-2 right-3 z-[var(--stack-sticky)] flex flex-col gap-1 p-2"
    />
  );
}

/** One row of the card: a field and the controls after it. */
export function FindRow({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-1">{children}</div>;
}

/** The frame round a field and the toggles inside it, strengthening while you type in it. */
export function FindField({ children }: { children: ReactNode }) {
  return (
    <Surface tone="none" edge="field" radius="md" className="flex h-7 w-55 items-center pr-1 pl-2">
      {children}
    </Surface>
  );
}

/** Where the search is (`2/7`), or that nothing matches, in the danger tone. */
export function FindStatus({
  empty,
  ...props
}: HTMLAttributes<HTMLElement> & { empty: boolean; children: ReactNode }) {
  return (
    <Text
      {...props}
      bare
      tone={empty ? "removed" : "muted"}
      className="min-w-14 flex-none text-center text-micro tabular-nums"
    />
  );
}
