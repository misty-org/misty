/** What the search box looks through. `default` is the web plus everything the address bar knows. */
export type SearchScope =
  | "default"
  | "files"
  | "spaces"
  | "notes"
  | "tasks"
  | "chat"
  | "agents"
  | "bookmarks"
  | "history"
  | "tabs"
  | "downloads"
  | "settings"
  | "extensions";

interface BangBase {
  /** Typed after `!`, lowercase. */
  trigger: string;
  aliases: string[];
  label: string;
  description: string;
}

/** Searches something inside Misty, in the box itself. */
export interface ScopeBang extends BangBase {
  kind: "scope";
  group: "misty";
  scope: Exclude<SearchScope, "default">;
  placeholder: string;
}

/** Sends the query to a website. */
export interface WebBang extends BangBase {
  kind: "web";
  group: "web" | "custom";
  /** `%s` is replaced with the URI-encoded query. */
  url: string;
  /** Opened when there is no query; the site's front page. */
  home: string;
}

export type Bang = ScopeBang | WebBang;
