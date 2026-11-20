import { ChevronDown, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { OverflowFadeText, Pressable, RowTools, Text } from "@misty/ui";

/**
 * A titled group of rows, after OpenChamber's session card: the header is one row tall, its glyph
 * in the same column as the rows' glyphs, its title a step brighter and larger than theirs, and at
 * the far end what it is about (the model, a count) in the rows' value type. A group that folds
 * says so with a chevron before its title. `tools` show only while the pointer is on the header,
 * at its far end; the subject gives way to them while they show.
 */
export function Section(props: {
  title: string;
  icon?: LucideIcon;
  subject?: ReactNode;
  /** A control after the subject, at the header's far end. */
  end?: ReactNode;
  /** Buttons at the header's far end, shown only while the pointer is on it (RowTools `hover`). */
  tools?: ReactNode;
  open?: boolean;
  onToggle?(): void;
  children?: ReactNode;
}) {
  const Icon = props.icon;
  const title = (
    <>
      {props.onToggle ? (
        <Text bare tone="muted" className="flex flex-none">
          <ChevronDown
            aria-hidden="true"
            className="-rotate-90 transition-transform duration-120 ease-[ease] data-[open]:rotate-0"
            data-open={props.open || undefined}
          />
        </Text>
      ) : Icon ? (
        <Text bare tone="default" className="flex flex-none">
          <Icon aria-hidden="true" />
        </Text>
      ) : null}
      <Text as="h3" bare size="control" weight="medium" tone="bright" className="m-0 flex-none">
        {props.title}
      </Text>
    </>
  );
  return (
    <section className="flex flex-col">
      <header className="group/row relative flex h-7 min-w-0 items-center gap-2">
        {props.onToggle ? (
          <Pressable
            type="button"
            className="flex flex-none items-center gap-2"
            aria-expanded={props.open}
            onClick={props.onToggle}
          >
            {title}
          </Pressable>
        ) : (
          title
        )}
        {props.subject ? (
          <Text
            bare
            size="meta"
            tone="default"
            className="ml-auto flex min-w-0 items-center tabular-nums"
          >
            {props.subject}
          </Text>
        ) : null}
        {props.end ? <span className="-my-0.5 -mr-1 flex flex-none">{props.end}</span> : null}
        {props.tools ? <RowTools reveal="hover">{props.tools}</RowTools> : null}
      </header>
      {props.onToggle && !props.open ? null : props.children}
    </section>
  );
}

const rowClass =
  "flex h-7 w-full min-w-0 items-center gap-2 rounded-md text-left [&>svg]:flex-none";

export function Row(props: {
  icon?: LucideIcon;
  label: ReactNode;
  value?: ReactNode;
  onOpen?(): void;
  /** For a row that shows and hides more rows. */
  expanded?: boolean;
}) {
  const Icon = props.icon;
  const body = (
    <>
      {Icon ? <Icon aria-hidden="true" /> : null}
      <span className="flex min-w-0 flex-1">
        <OverflowFadeText>{props.label}</OverflowFadeText>
      </span>
      {props.value === undefined ? null : (
        <Text
          bare
          tone="default"
          className="flex max-w-[60%] flex-none items-center gap-1.5 tabular-nums"
        >
          {props.value}
        </Text>
      )}
    </>
  );
  // Muted at rest; a row that opens something brightens under the pointer and on focus.
  return props.onOpen ? (
    <Text as="div" bare size="meta" tone="muted">
      <Pressable
        type="button"
        wash="text"
        className={rowClass}
        aria-expanded={props.expanded}
        onClick={props.onOpen}
      >
        {body}
      </Pressable>
    </Text>
  ) : (
    <Text as="div" bare size="meta" tone="muted" className={rowClass}>
      {body}
    </Text>
  );
}
