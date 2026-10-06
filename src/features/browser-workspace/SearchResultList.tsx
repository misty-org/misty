import { Fragment, useEffect, useRef, useState } from "react";
import {
  AppWindow,
  Bookmark,
  Bot,
  ChevronRight,
  FileCode2,
  Download,
  File,
  Folder,
  Globe2,
  History,
  LayoutGrid,
  Library,
  MessageSquare,
  NotebookPen,
  PenTool,
  Puzzle,
  RotateCcw,
  Search,
  Settings,
  Star,
  type LucideIcon,
} from "lucide-react";
import { BrandIcon, brandIconAsset, cn } from "@/shared/ui";
import { AgentAvatar } from "@/features/agents/AgentAvatar";
import type { AgentProfile } from "@/shared/schemas";
import mistyIcon from "@/assets/branding/misty-icon.png?inline";
import { omniboxMatchIcon, type OmniboxMatch } from "@/features/browser/omnibox";
import type { Bang, SearchScope } from "./bangs/types";
import type { ScopedSearchKind, ScopedSearchResult } from "./scopedSearchSources";

export type SearchListItem =
  /** Sends the text to an agent: a new chat with it. */
  | { type: "ask"; agent: AgentProfile; prompt: string }
  /** `query` carries text typed before a trailing `!name`. */
  | { type: "bang"; bang: Bang; query?: string }
  | { type: "match"; match: OmniboxMatch }
  | { type: "result"; result: ScopedSearchResult };

const resultIcons: Record<ScopedSearchKind, LucideIcon> = {
  file: File,
  folder: Folder,
  space: LayoutGrid,
  "space-item": Library,
  note: NotebookPen,
  drawing: PenTool,
  code: FileCode2,
  message: MessageSquare,
  agent: Bot,
  conversation: History,
  bookmark: Bookmark,
  history: History,
  "closed-tab": RotateCcw,
  tab: AppWindow,
  download: Download,
  setting: Settings,
  extension: Puzzle,
  action: ChevronRight,
};

const scopeIcons: Record<Exclude<SearchScope, "default">, LucideIcon> = {
  files: Folder,
  spaces: LayoutGrid,
  notes: NotebookPen,
  drawings: PenTool,
  code: FileCode2,
  chat: MessageSquare,
  agents: Bot,
  ask: Bot,
  bookmarks: Bookmark,
  history: History,
  tabs: AppWindow,
  downloads: Download,
  settings: Settings,
  extensions: Puzzle,
};

/** The site's icon for a website shortcut, the globe when it has none. */
function WebBangIcon({ home }: { home: string }) {
  const [failed, setFailed] = useState(false);
  let src: string | null = null;
  try {
    src = `${new URL(home).origin}/favicon.ico`;
  } catch {
    // No usable home page.
  }
  if (!src || failed)
    return <Globe2 size={14} className="shrink-0 text-zinc-400" aria-hidden="true" />;
  return (
    <img
      src={src}
      alt=""
      className="size-4 shrink-0 rounded-sm object-contain"
      onError={() => setFailed(true)}
    />
  );
}

const groupLabels: Record<Bang["group"], string> = {
  misty: "Misty",
  custom: "Your shortcuts",
  web: "Web",
};

function itemKey(item: SearchListItem): string {
  if (item.type === "bang") return `bang:${item.bang.trigger}`;
  if (item.type === "ask") return `ask:${item.agent.id}`;
  return item.type === "match" ? item.match.id : item.result.id;
}

function formatDetail(item: SearchListItem): string {
  if (item.type === "bang") return item.query ? item.bang.label : item.bang.description;
  if (item.type === "ask") return item.agent.name;
  if (item.type === "result") {
    return item.result.subtitle;
  }
  const match = item.match;
  if (match.kind === "search" || match.kind === "suggestion") {
    return match.detail;
  }
  const urlStr = match.target.type !== "open-in-app" ? match.target.url : "";
  if (!urlStr) return match.detail;
  try {
    const url = new URL(urlStr);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      return `${url.protocol}//${url.host}`;
    }
    return url.host.replace(/^www\./i, "");
  } catch {
    return match.detail;
  }
}

function ItemIcon({ item }: { item: SearchListItem }) {
  const [imgError, setImgError] = useState(false);

  if (item.type === "ask")
    return (
      <span className="inline-flex size-4 shrink-0">
        <AgentAvatar agent={item.agent} />
      </span>
    );

  if (item.type === "bang") {
    const { bang } = item;
    // A shortcut on its own is shown as text, without an icon.
    if (!item.query) return null;
    const Icon = bang.kind === "scope" ? scopeIcons[bang.scope] : Search;
    return (
      <div className="relative flex size-4 shrink-0 items-center justify-center">
        {bang.kind === "web" ? (
          <WebBangIcon home={bang.home} />
        ) : (
          <Icon size={14} className="shrink-0 text-zinc-400" aria-hidden="true" />
        )}
      </div>
    );
  }

  if (item.type === "result") {
    const Icon = resultIcons[item.result.kind] ?? Globe2;
    return (
      <div className="relative flex size-4 shrink-0 items-center justify-center">
        <Icon size={14} className="shrink-0 text-zinc-400" aria-hidden="true" />
      </div>
    );
  }

  const match = item.match;
  const urlStr = match.target.type !== "open-in-app" ? match.target.url : "";
  const isBookmarked = Boolean(match.bookmarked || match.kind === "bookmark");

  let urlObj: URL | null = null;
  try {
    if (urlStr) urlObj = new URL(urlStr);
  } catch {
    // ignore
  }

  const host = urlObj?.host.toLowerCase() ?? "";
  const isLocalhost = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  const isMisty =
    host.includes("mistysys.com") ||
    host.includes("misty.local") ||
    match.title.toLowerCase().includes("misty");
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
      <img
        src={match.faviconUrl}
        alt=""
        className="size-4 shrink-0 rounded-sm object-contain"
        onError={() => setImgError(true)}
      />
    );
  } else if (isLocalhost) {
    content = <span className="size-4 shrink-0" aria-hidden="true" />;
  } else if (match.kind === "search" || match.kind === "suggestion") {
    content = <Search size={14} className="shrink-0 text-zinc-400" aria-hidden="true" />;
  } else {
    const Icon = omniboxMatchIcon(match);
    content = <Icon size={14} className="shrink-0 text-zinc-400" aria-hidden="true" />;
  }

  return (
    <div className="relative flex size-4 shrink-0 items-center justify-center">
      {content}
      {isBookmarked && (
        <Star
          size={9}
          className="absolute -bottom-1 -right-1 fill-zinc-300 stroke-[1.5] text-zinc-300"
          aria-hidden="true"
        />
      )}
    </div>
  );
}

/** Rows name only the target: the address, the search, the agent's message or the place. */
function Row(props: { item: SearchListItem }) {
  const { item } = props;
  const title =
    item.type === "bang"
      ? item.query || `!${item.bang.trigger}`
      : item.type === "ask"
        ? item.prompt || `Ask ${item.agent.name}`
        : item.type === "match"
          ? item.match.title
          : item.result.title;
  const bangOnly = item.type === "bang" && !item.query;

  const detail = formatDetail(item);

  return (
    <>
      <ItemIcon item={item} />
      <div className="flex min-w-0 flex-1 items-center text-sm">
        <span className={cn("truncate font-normal text-zinc-100", bangOnly && "font-mono")}>
          {title}
        </span>
        {detail && (
          <span className="ml-3 min-w-0 truncate text-xs font-normal text-zinc-500 sm:text-sm">
            {detail}
          </span>
        )}
      </div>
    </>
  );
}

export function SearchResultList(props: {
  items: SearchListItem[];
  activeIndex: number;
  onHover(index: number): void;
  onChoose(item: SearchListItem): void;
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
        const previous = props.items[index - 1];
        // Shortcut lists are grouped; a single carried-over shortcut is not.
        const header =
          item.type === "bang" &&
          !item.query &&
          (previous?.type !== "bang" || previous.bang.group !== item.bang.group)
            ? groupLabels[item.bang.group]
            : null;
        return (
          <Fragment key={itemKey(item)}>
            {header && (
              <li
                role="presentation"
                className="px-3 pb-1 pt-2 text-[11px] font-medium text-zinc-400"
              >
                {header}
              </li>
            )}
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
                  ? "bg-white/[0.08] text-white"
                  : "text-zinc-200 hover:bg-white/[0.04]",
              )}
            >
              <Row item={item} />
            </li>
          </Fragment>
        );
      })}
    </ul>
  );
}
