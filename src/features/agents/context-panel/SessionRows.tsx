import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { FoldChevron, OverflowFadeText, Pressable, RowTools, Text } from "@misty/ui";

export function Section(props: {
  title: string;
  icon?: LucideIcon;
  subject?: ReactNode;
  end?: ReactNode;
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
          <FoldChevron open={Boolean(props.open)} />
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
