import { invoke } from "@tauri-apps/api/core";
import { Clock, Search } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Input, SuggestionItem, SuggestionList } from "@misty/ui";
import { SiteIcon } from "../webviews/SiteIcon";
import { looksLikeAddress, pageLabel, shownAddress, webAddress } from "./web_address";
import { fetchSuggestions, type SearchSuggestion } from "./web_search";
import { useWebTabs } from "./web_tab_store";

type Suggestion =
  | { kind: "go"; text: string }
  | { kind: "tab"; id: string; url: string; title: string }
  | { kind: "history"; url: string; title: string }
  | { kind: "query"; text: string }
  | { kind: "site"; url: string; title: string };

type HistoryRow = { url: string; title: string };

const web = (url: string) => /^https?:\/\//i.test(url);

function matches(text: string, url: string, title: string) {
  const query = text.toLowerCase();
  return url.toLowerCase().includes(query) || title.toLowerCase().includes(query);
}

function startsHost(typed: string, url: string) {
  if (/\s/.test(typed)) return false;
  const host = shownAddress(url).host.toLowerCase();
  return Boolean(host) && host.startsWith(typed.toLowerCase().replace(/^https?:\/\/(www\.)?/, ""));
}

function keyOf(suggestion: Suggestion) {
  if (suggestion.kind === "go") return "go";
  if (suggestion.kind === "query") return `query:${suggestion.text}`;
  return `${suggestion.kind}:${suggestion.url}`;
}

function rank(
  typed: string,
  tabs: Suggestion[],
  history: HistoryRow[],
  remote: SearchSuggestion[],
): Suggestion[] {
  if (!typed) return [];
  const seen = new Set<string>();
  const fresh = (url: string) => {
    const known = seen.has(url);
    seen.add(url);
    return !known;
  };
  tabs.forEach((tab) => tab.kind === "tab" && seen.add(tab.url));
  const best = history.find((row) => startsHost(typed, row.url));
  const lead: Suggestion[] = best
    ? [{ kind: "history", ...best }, { kind: "go", text: typed }]
    : [{ kind: "go", text: typed }];
  if (best) seen.add(best.url);
  const visited = history
    .filter((row) => fresh(row.url))
    .slice(0, 5)
    .map((row): Suggestion => ({ kind: "history", ...row }));
  const sites = remote
    .filter((item): item is Extract<SearchSuggestion, { kind: "site" }> => item.kind === "site")
    .filter((item) => fresh(item.url))
    .slice(0, 2)
    .map((item): Suggestion => ({ kind: "site", url: item.url, title: item.text }));
  const queries = remote
    .filter((item): item is Extract<SearchSuggestion, { kind: "query" }> => item.kind === "query")
    .slice(0, 4)
    .map((item): Suggestion => ({ kind: "query", text: item.text }));
  return [...lead, ...tabs.slice(0, 3), ...visited, ...sites, ...queries];
}

function detailOf(suggestion: Suggestion) {
  switch (suggestion.kind) {
    case "go":
      return looksLikeAddress(suggestion.text) ? "Open" : "Search Google";
    case "tab":
      return "Switch to tab";
    case "query":
      return "Search Google";
    default:
      return suggestion.url.replace(/^https?:\/\/(www\.)?/, "");
  }
}

export function WebAddressField(props: {
  tabId: string;
  url: string;
  autoFocus: boolean;
  onGo(text: string): void;
  onOpenBeside(url: string): void;
  onSwitchTab(id: string): void;
}) {
  const { tabId, url, onGo, onOpenBeside, onSwitchTab } = props;
  const input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [remote, setRemote] = useState<SearchSuggestion[]>([]);
  const [selected, setSelected] = useState(0);
  const tabs = useWebTabs((state) => state.tabs);
  const shown = web(url) ? url : "";
  const typed = draft?.trim() ?? "";

  useEffect(() => {
    if (props.autoFocus) input.current?.focus();
  }, [props.autoFocus]);

  useEffect(() => {
    if (!typed) {
      setHistory([]);
      setRemote([]);
      return;
    }
    let current = true;
    void invoke<HistoryRow[]>("browser_history_suggest", { request: { query: typed, limit: 8 } })
      .then((rows) => {
        if (current) setHistory(rows);
      })
      .catch(() => undefined);
    void fetchSuggestions(typed).then((rows) => {
      if (current) setRemote(rows);
    });
    return () => {
      current = false;
    };
  }, [typed]);

  const open: Suggestion[] = typed
    ? Object.values(tabs)
        .filter((tab) => tab.id !== tabId && web(tab.url) && matches(typed, tab.url, tab.title))
        .map((tab) => ({ kind: "tab", id: tab.id, url: tab.url, title: tab.title }))
    : [];
  const suggestions = rank(typed, open, history, remote);
  const active = Math.min(selected, Math.max(0, suggestions.length - 1));

  const finish = () => {
    setDraft(null);
    setSelected(0);
    input.current?.blur();
  };
  const addressOf = (suggestion: Suggestion) =>
    suggestion.kind === "go" || suggestion.kind === "query"
      ? webAddress(suggestion.text)
      : suggestion.url;
  const pick = (suggestion: Suggestion, beside = false) => {
    finish();
    if (beside) {
      const address = addressOf(suggestion);
      if (address) onOpenBeside(address);
      return;
    }
    if (suggestion.kind === "tab") onSwitchTab(suggestion.id);
    else if (suggestion.kind === "go" || suggestion.kind === "query") onGo(suggestion.text);
    else onGo(suggestion.url);
  };
  const forget = (suggestion: Suggestion) => {
    if (suggestion.kind !== "history") return;
    setHistory((rows) => rows.filter((row) => row.url !== suggestion.url));
    void invoke("browser_history_forget", { request: { url: suggestion.url } }).catch(
      () => undefined,
    );
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      finish();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!suggestions.length) return;
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setSelected((active + step + suggestions.length) % suggestions.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const suggestion = suggestions[active];
      if (suggestion) pick(suggestion, event.metaKey || event.ctrlKey);
    } else if (event.key === "Delete" || (event.key === "Backspace" && event.shiftKey)) {
      const suggestion = suggestions[active];
      if (suggestion?.kind !== "history" || !event.shiftKey) return;
      event.preventDefault();
      forget(suggestion);
    }
  };

  return (
    <div className="relative min-w-0 flex-1">
      <Input
        ref={input}
        variant="address"
        aria-label="Address"
        placeholder="Search or enter address"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        value={draft ?? shown}
        onFocus={(event) => {
          setDraft(event.currentTarget.value);
          event.currentTarget.select();
        }}
        onBlur={() => {
          setDraft(null);
          setSelected(0);
        }}
        onChange={(event) => {
          setDraft(event.target.value);
          setSelected(0);
        }}
        onKeyDown={onKeyDown}
      />
      {draft !== null && suggestions.length ? (
        <SuggestionList
          aria-label="Suggestions"
          className="absolute top-full right-0 left-0 z-[var(--stack-overlay)] mt-1"
        >
          {suggestions.map((suggestion, index) => (
            <SuggestionItem
              key={keyOf(suggestion)}
              selected={index === active}
              onPointerDown={(event) => pick(suggestion, event.metaKey || event.ctrlKey)}
              onPointerEnter={() => setSelected(index)}
              icon={
                suggestion.kind === "go" || suggestion.kind === "query" ? (
                  Search
                ) : suggestion.kind === "history" ? (
                  Clock
                ) : (
                  <SiteIcon
                    url={suggestion.url}
                    icon={suggestion.kind === "tab" ? tabs[suggestion.id]?.faviconUrl : undefined}
                    className="size-4 shrink-0 rounded-sm"
                  />
                )
              }
              label={
                suggestion.kind === "go" || suggestion.kind === "query"
                  ? suggestion.text
                  : pageLabel(suggestion.url, suggestion.title)
              }
              detail={detailOf(suggestion)}
            />
          ))}
        </SuggestionList>
      ) : null}
    </div>
  );
}
