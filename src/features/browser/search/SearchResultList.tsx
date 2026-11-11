import { mistyPublicHost } from "@/shared/platform/mistyPublicUrl";
import { Fragment, useEffect, useRef, useState } from "react";
import { Search, Star, X } from "lucide-react";
import { BrandIcon, brandIconAsset, cn, IconButton } from "@/shared/ui";
import mistyIcon from "@/shared/assets/branding/misty-icon.png?inline";
import { omniboxMatchIcon, type OmniboxMatch } from "@/features/browser/omnibox";
import { SiteIcon } from "../webviews/SiteIcon";

export type SearchListItem = { type: "match"; match: OmniboxMatch };

function ItemIcon({ item }: { item: SearchListItem }) {
  const [imgError, setImgError] = useState(false);

  const match = item.match;
  const urlStr = match.target.url;
  const isBookmarked = Boolean(match.bookmarked || match.kind === "bookmark");

  let urlObj: URL | null = null;
  try {
    if (urlStr) urlObj = new URL(urlStr);
  } catch {
    // ignore
  }

  const host = urlObj?.host.toLowerCase() ?? "";
  const isLocalhost = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  const mistyHost = mistyPublicHost();
  const isMisty = (mistyHost && host === mistyHost) || host.includes("misty.local");
  const isOpenAi = host.includes("chatgpt.com") || host.includes("openai.com");
  const isYouTube = [host, match.faviconUrl ?? ""].some((value) =>
    /youtube\.com|youtu\.be/.test(value.toLowerCase()),
  );

  let content: React.ReactNode = null;

  if (isMisty) {
    content = <img src={mistyIcon} alt="" className="size-4 shrink-0 rounded-sm object-contain" />;
  } else if (isOpenAi) {
    content = <BrandIcon brand="openai" size={16} className="shrink-0" />;
  } else if (isYouTube && brandIconAsset("youtube")) {
    content = <BrandIcon brand="youtube" size={16} className="shrink-0" />;
  } else if (match.faviconUrl && !imgError) {
    content = (
      <SiteIcon
        url={match.faviconUrl}
        className="size-4 shrink-0 rounded-sm object-contain"
        onFailed={() => setImgError(true)}
      />
    );
  } else if (isLocalhost) {
    content = <span className="size-4 shrink-0" aria-hidden="true" />;
  } else if (match.kind === "search" || match.kind === "suggestion") {
    content = <Search size={14} className="shrink-0 text-cream-muted" aria-hidden="true" />;
  } else {
    const Icon = omniboxMatchIcon(match);
    content = <Icon size={14} className="shrink-0 text-cream-muted" aria-hidden="true" />;
  }

  return (
    <div className="relative flex size-4 shrink-0 items-center justify-center">
      {content}
      {isBookmarked && (
        <Star
          size={9}
          className="absolute -bottom-1 -right-1 fill-cream stroke-[1.5] text-cream"
          aria-hidden="true"
        />
      )}
    </div>
  );
}

/** Rows show only the page's title or the search; the address is never listed beside it. */
function Row(props: { item: SearchListItem }) {
  const { item } = props;
  const title = item.match.title;

  return (
    <>
      <ItemIcon item={item} />
      <div className="flex min-w-0 flex-1 items-center text-sm">
        <span className="truncate font-normal text-cream-bright">{title}</span>
      </div>
    </>
  );
}

export function SearchResultList(props: {
  items: SearchListItem[];
  activeIndex: number;
  onHover(index: number): void;
  onChoose(item: SearchListItem): void;
  /** Forgets a removable row's page. */
  onRemove(item: SearchListItem): void;
}) {
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" });
  }, [props.activeIndex, props.items]);
  if (!props.items.length) return null;
  return (
    <ul
      ref={list}
      role="listbox"
      aria-label="Search results"
      className="max-h-[360px] space-y-0.5 overflow-y-auto p-1.5"
    >
      {props.items.map((item, index) => {
        return (
          <Fragment key={item.match.id}>
            <li
              role="option"
              aria-selected={index === props.activeIndex}
              onMouseEnter={() => props.onHover(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                props.onChoose(item);
              }}
              className={cn(
                "group flex cursor-default items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                index === props.activeIndex
                  ? "bg-control-active text-cream-bright"
                  : "text-cream hover:bg-control-hover",
              )}
            >
              <Row item={item} />
              {item.match.removable ? (
                <IconButton
                  label={`Remove ${item.match.title} from history`}
                  size="xs"
                  tabIndex={-1}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    props.onRemove(item);
                  }}
                  className={cn(
                    "-mr-2 shrink-0 text-cream-muted opacity-0 transition-opacity",
                    "hover:text-cream-bright group-hover:opacity-100",
                    index === props.activeIndex && "opacity-100",
                  )}
                >
                  <X size={14} aria-hidden="true" />
                </IconButton>
              ) : null}
            </li>
          </Fragment>
        );
      })}
    </ul>
  );
}
