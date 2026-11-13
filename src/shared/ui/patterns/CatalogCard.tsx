import { Check, Link2 } from "lucide-react";
import * as React from "react";

import { cn } from "../classNames";
import { Surface } from "../display/Surface";
import { Text } from "../display/Text";
import { BrandIcon } from "../icons/BrandIcon";
import { OverflowFadeText } from "../layout/OverflowFadeText";
import { RowActions } from "../overlays/RowActions";

/*
 * A catalog of things to add, such as an engine's plugins or skills: a grid of cards, each with
 * its maker's logo, what it does, where it comes from, and the one action to take. Logos sit on
 * one neutral tile, so no maker's color decides how loud its card is.
 */

const tileSize = {
  sm: "size-6 [&>*]:max-h-4.5 [&>*]:max-w-4.5",
  md: "size-8 [&>*]:max-h-6 [&>*]:max-w-6",
} as const;

/**
 * The box a catalog logo stands in. A logo stands bare, with no fill or edge behind it, in its own
 * colors; only a picture (a maker's GitHub avatar) takes a shape, as an avatar does.
 */
export function LogoTile({
  size = "md",
  cover = false,
  children,
}: {
  size?: keyof typeof tileSize;
  /** The logo is a picture that fills the box (an avatar), rather than a mark set inside it. */
  cover?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center",
        tileSize[size],
        cover &&
          "overflow-hidden rounded-md [&>*]:size-full [&>*]:max-h-none [&>*]:max-w-none [&>img]:object-cover",
      )}
    >
      {children}
    </span>
  );
}

/** A card grid that fits as many columns as the width allows, each at least 16rem wide. */
export function CatalogGrid({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <ul
      aria-label={label}
      className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-2.5 p-0"
    >
      {children}
    </ul>
  );
}

/** Where a catalog item comes from: GitHub wears GitHub's mark, anywhere else a plain link. */
export interface CatalogSource {
  /** What the link shows, such as `obra/superpowers`. */
  label: string;
  href: string;
  onOpen(): void;
}

const onGithub = (href: string) => /^https:\/\/github\.com\//.test(href);

function SourceLink({ source }: { source: CatalogSource }) {
  return (
    <button
      type="button"
      onClick={source.onOpen}
      aria-label={`Open ${source.label}${onGithub(source.href) ? " on GitHub" : ""}`}
      className={cn(
        "inline-flex max-w-full min-w-0 items-center gap-1 self-start rounded-sm text-caption",
        "text-cream-muted outline-none hover:text-cream hover:underline focus-visible:text-cream",
        "focus-visible:underline",
      )}
    >
      {onGithub(source.href) ? (
        <BrandIcon brand="github" size={12} aria-hidden />
      ) : (
        <Link2 aria-hidden="true" className="size-3 shrink-0" />
      )}
      <OverflowFadeText className="min-w-0">{source.label}</OverflowFadeText>
    </button>
  );
}

/** "Installed", in the text color with a plain check: done, without a status color. */
export function CatalogDone({ label = "Installed" }: { label?: string }) {
  return (
    <span className="inline-flex h-8 items-center gap-1.5 px-1 text-control text-cream">
      <Check aria-hidden="true" className="size-4" />
      {label}
    </span>
  );
}

export interface CatalogCardProps {
  logo: React.ReactNode;
  title: string;
  /** Who made it. */
  maker?: string;
  description?: string;
  source?: CatalogSource;
  /** Short facts at its foot, such as its category; the first sits on a small chip. */
  tag?: string;
  /** A muted fact beside the tag, such as how many have installed it. */
  detail?: string;
  /** The one action at its foot (Install), or CatalogDone once it's done. */
  action?: React.ReactNode;
  /** Menu items for the ⋯ that shows on hover and opens on right-click. */
  menu?: React.ReactNode;
  menuLabel?: string;
  /** Opens its details: the title becomes the button that does. */
  onOpen?: () => void;
}

/** A title that opens its item's details, underlined under the pointer like a link. */
function TitleButton({ title, onOpen }: { title: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "min-w-0 rounded-sm text-left outline-none hover:underline focus-visible:underline",
        "decoration-cream-muted underline-offset-2",
      )}
    >
      <Text size="control" tone="bright" weight="semibold">
        {title}
      </Text>
    </button>
  );
}

/**
 * One item in a CatalogGrid.
 *
 * ```tsx
 * <CatalogCard logo={<LogoTile>…</LogoTile>} title="Superpowers" maker="obra"
 *   description="…" source={{ label: "obra/superpowers", href, onOpen }} tag="Development"
 *   detail="1.1M installs" action={<Button icon={Download}>Install</Button>} />
 * ```
 */
export function CatalogCard({
  logo,
  title,
  maker,
  description,
  source,
  tag,
  detail,
  action,
  menu,
  menuLabel,
  onOpen,
}: CatalogCardProps) {
  return (
    <Surface
      as="li"
      tone="card"
      edge="hairline"
      radius="xl"
      className={cn(
        "group/row relative flex min-w-0 flex-col gap-3 p-3.5 transition-colors",
        "hover:border-charcoal-border-strong",
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        {logo}
        <div className="grid min-w-0 flex-1 gap-0.5 pt-px">
          {onOpen ? (
            <h3 className="m-0 flex min-w-0">
              <TitleButton title={title} onOpen={onOpen} />
            </h3>
          ) : (
            <Text as="h3" size="control" tone="bright" weight="semibold" className="m-0">
              {title}
            </Text>
          )}
          {maker ? (
            <Text size="caption" tone="muted">
              by {maker}
            </Text>
          ) : null}
        </div>
        {menu ? <RowActions label={menuLabel ?? `Actions for ${title}`}>{menu}</RowActions> : null}
      </div>
      {description ? (
        <Text as="p" size="meta" tone="default" lines={2} className="m-0 min-h-10">
          {description}
        </Text>
      ) : null}
      {source ? <SourceLink source={source} /> : null}
      <div className="mt-auto flex min-w-0 items-center gap-2">
        {tag ? (
          <Surface tone="well" radius="sm" className="shrink-0 px-1.5 py-0.5">
            <Text size="caption" tone="muted">
              {tag}
            </Text>
          </Surface>
        ) : null}
        {detail ? (
          <Text size="caption" tone="muted" className="tabular-nums">
            {detail}
          </Text>
        ) : null}
        <span className="flex-1" />
        {action}
      </div>
    </Surface>
  );
}

/**
 * A compact card for something already added, in a row above the catalog: its logo, its name,
 * one line on its state, and its menu.
 */
export function CatalogTile({
  logo,
  title,
  line,
  control,
  menu,
  menuLabel,
  onOpen,
}: {
  logo: React.ReactNode;
  title: string;
  line?: string;
  /** One control before the menu, such as the Switch that turns it on and off. */
  control?: React.ReactNode;
  menu?: React.ReactNode;
  menuLabel?: string;
  onOpen?: () => void;
}) {
  return (
    <Surface
      as="li"
      tone="card"
      edge="hairline"
      radius="xl"
      className="group/row flex min-w-0 items-center gap-2.5 py-2.5 pr-2 pl-3"
    >
      {logo}
      <div className="grid min-w-0 flex-1">
        {onOpen ? (
          <TitleButton title={title} onOpen={onOpen} />
        ) : (
          <Text size="control" tone="bright" weight="medium">
            {title}
          </Text>
        )}
        {line ? (
          <Text size="caption" tone="muted">
            {line}
          </Text>
        ) : null}
      </div>
      {control}
      {menu ? <RowActions label={menuLabel ?? `Actions for ${title}`}>{menu}</RowActions> : null}
    </Surface>
  );
}

/**
 * Names on small chips, wrapping across lines: what a plugin adds (its skills, its commands).
 * Past `most`, the rest are counted.
 */
export function CatalogNames({ names, most = 24 }: { names: readonly string[]; most?: number }) {
  const shown = names.slice(0, most);
  return (
    <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
      {shown.map((name) => (
        <Surface key={name} as="li" tone="well" radius="sm" className="px-1.5 py-0.5">
          <Text size="caption" tone="default">
            {name}
          </Text>
        </Surface>
      ))}
      {names.length > shown.length ? (
        <li className="px-1 py-0.5">
          <Text size="caption" tone="muted">
            and {names.length - shown.length} more
          </Text>
        </li>
      ) : null}
    </ul>
  );
}

/** The row of CatalogTiles for what's already added. */
export function CatalogTileRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <ul
      aria-label={label}
      className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-2 p-0"
    >
      {children}
    </ul>
  );
}
