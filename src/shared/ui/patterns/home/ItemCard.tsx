import type { MouseEvent, ReactNode } from "react";
import { cn } from "../../classNames";
import { Pressable } from "../../controls/Pressable";
import { Surface } from "../../display/Surface";
import { Text } from "../../display/Text";

/**
 * One thing in a Space as a card, the one card every page of the Space shows things in (the home's
 * docs and drawings, the Lab's notebooks): a cover that previews it, then under the cover, on the
 * page itself, the kind's glyph and its title, one quiet line about it, and a foot for who made
 * it and what's happening. The cover is the card's only shape, as an album or a file in Finder:
 * no box around the words. It lifts under the pointer; a picked card's cover takes a strong edge.
 * Controls over the card (a menu) come as children, outside its press area, over the cover.
 */
export function ItemCard(props: {
  /** The preview, filling the cover. */
  cover: ReactNode;
  /** Over the cover's top start: something live, such as who has it open. */
  coverBadge?: ReactNode;
  /** The kind's glyph, before the title. */
  glyph: ReactNode;
  title: ReactNode;
  /** One quiet line under the title. */
  meta: ReactNode;
  /** Under that: who made it, or what's being done with it now. */
  footer?: ReactNode;
  /** What the card is, for assistive tech: its kind and title. */
  label: string;
  selected?: boolean;
  onClick(event: MouseEvent): void;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={cn("group/card relative min-w-0", props.className)}>
      <Pressable
        onClick={props.onClick}
        aria-label={props.label}
        className="flex w-full min-w-0 flex-col text-left outline-none"
      >
        <Surface
          as="span"
          tone={props.selected ? "active" : "card"}
          edge={props.selected ? "strong" : "none"}
          radius="xl"
          className={cn(
            "relative block aspect-[16/10] w-full overflow-hidden transition-colors duration-120",
            !props.selected &&
              "group-hover/card:bg-charcoal-hover group-has-[:focus-visible]/card:bg-charcoal-hover",
          )}
        >
          <span className="block size-full overflow-hidden">{props.cover}</span>
          {props.coverBadge ? (
            <span className="absolute top-3 left-3 flex">{props.coverBadge}</span>
          ) : null}
        </Surface>
        <span className="block px-0.5 pt-2.5">
          <span className="flex min-w-0 items-center gap-2">
            <span aria-hidden className="flex shrink-0 [&_svg]:size-4">
              {props.glyph}
            </span>
            <Text full tone="bright" className="min-w-0 text-base">
              {props.title}
            </Text>
          </span>
          <Text bare tone="muted" className="mt-1 flex items-center gap-1.5 text-sm">
            {props.meta}
          </Text>
          {props.footer ? (
            <Text bare tone="muted" className="mt-1.5 flex min-h-5 items-center gap-1.5 text-sm">
              {props.footer}
            </Text>
          ) : null}
        </span>
      </Pressable>
      {props.children}
    </div>
  );
}
